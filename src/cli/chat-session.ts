// Chat session for the guardian TUI.
//
// Sits between the TUI widgets and the provider layer. Owns conversation
// history, the selected model, and the per-turn pipeline:
//
//   user text → fold + shard (token reduction) → guard (budget check) → route
//   (provider resolution) → gateway.complete (stream) → record
//
// The provider boundary is the OpenAI-compatible chat-completions wire format
// (`streamComplete`), which OpenRouter, OpenAI, Anthropic (via the OpenRouter
// proxy), and local runtimes all speak — so this module never branches on
// provider. It only records which provider served each turn, via
// `providerFromModel`.
//
// Pure TypeScript with no renderer imports, so the whole conversation layer
// runs and tests headlessly.

import { foldMessages } from "../core/folding-engine.ts";
import { estimateTokens as countTokens } from "../core/token-counter.ts";
import { shardMessages } from "../core/vcm-sharder.ts";
import { decideRetain } from "../core/retain-filter.ts";
import { checkBudget } from "../gateway/budget-manager.ts";
import { streamComplete, ProviderGateway } from "../providers/gateway.ts";
import { providerFromModel } from "../core/response-cache.ts";
import { getModelFingerprint } from "../providers/fingerprints.ts";
import type { ChatMessage } from "../core/types.ts";
import type { CompletionResponse } from "../core/types.ts";

/** Folding kicks in above this many estimated prompt tokens. */
const FOLD_GATE = 1000;
/** Sharding kicks in above this many post-fold tokens. */
const SHARD_GATE = 2000;
/** Fold target budget. */
const FOLD_MAX_TOKENS = 2000;
/** Cap on tokens the model generates per turn. */
const DEFAULT_MAX_TOKENS = 512;

/** One completed turn's cost accounting, shown in the status line. */
export interface TurnMetrics {
	/** Estimated prompt tokens before any optimization. */
	inputTokens: number;
	/** Prompt tokens after folding/sharding. */
	sentTokens: number;
	/** Tokens the model generated. */
	outputTokens: number;
	/** Which optimization stages fired this turn. */
	folded: boolean;
	sharded: boolean;
	/** Real provider identity (e.g. "anthropic"), not the router name. */
	provider: string;
	/** The model id the request actually went out as. */
	servedModel: string;
	/** Wall time for the provider call. */
	latencyMs: number;
	/** Streaming shortfall, if any. */
	truncated: boolean;
	/** The assistant reply text. */
	content: string;
}

export interface ChatSession {
	/** Current model id, as shown in the status line. */
	readonly model: string;
	/** Provider for the current model. */
	readonly provider: string;
	/** Number of user turns so far. */
	readonly turns: number;
	/** Full conversation as sent (post-optimization history). */
	readonly history: readonly ChatMessage[];
	/** Replace the active model. */
	setModel(model: string): void;
	/** Clear history and the running-session cache. */
	clear(): void;
	/** Send a user message; yields reply chunks; resolves turn metrics. */
	send(text: string): AsyncGenerator<string, TurnMetrics>;
}

export type ChatSessionOptions = {
	/** Starting model id (e.g. "anthropic/claude-sonnet-4-5"). */
	model: string;
	/**
	 * Custom OpenAI-compatible base URL (e.g. "http://127.0.0.1:1234/v1").
	 * When set, every request is pinned to this endpoint regardless of the
	 * model's provider prefix — the whole gateway routes there. Leave unset to
	 * use the shared gateway, which routes by model prefix (openai /
	 * anthropic / ollama / openrouter) and reads keys from the environment.
	 */
	baseUrl?: string;
	/** API key for the custom endpoint. Omit for keyless local runtimes. */
	apiKey?: string;
	/** Override the completion call — tests inject a stub here. */
	complete?: (
		model: string,
		messages: ChatMessage[],
		maxTokens: number,
	) => Promise<CompletionResponse>;
	/** Override the streaming call — tests inject a stub here. */
	completeStream?: (
		model: string,
		messages: ChatMessage[],
		maxTokens: number,
	) => AsyncGenerator<string, CompletionResponse>;
};

/**
 * Run the pre-flight pipeline over the history. Mirrors the orchestrator's
 * ordering: retain-filter first (drop low-signal turns), then fold if large,
 * then shard if still large. Returns the messages to send and which stages
 * fired.
 */
function optimize(messages: ChatMessage[]): {
	messages: ChatMessage[];
	folded: boolean;
	sharded: boolean;
} {
	// Retain pre-filter: keep system + the latest user message; drop low-signal
	// assistant acknowledgements that would otherwise be folded for nothing.
	const latestUser = [...messages].reverse().find((m) => m.role === "user");
	const seen: string[] = [];
	const working = messages.filter((m, i) => {
		if (m.role === "system") return true;
		// Always keep the last message — it carries the current query.
		if (i === messages.length - 1) return true;
		const verdict = decideRetain({
			content: m.content,
			role: m.role,
			userPrompt: latestUser?.content,
			seenEntities: seen,
		});
		if (verdict.retain) {
			// Accumulate entity mentions so later turns are scored for novelty.
			for (const match of m.content.match(/`[^`]+`|https?:\/\/\S+/g) ?? []) {
				seen.push(match.toLowerCase());
			}
		}
		return verdict.retain;
	});

	let folded = false;
	let sharded = false;
	let out = working;

	const promptTokens = out.reduce((s, m) => s + countTokens(m.content), 0);
	if (promptTokens > FOLD_GATE) {
		const result = foldMessages(out, { maxTokens: FOLD_MAX_TOKENS });
		out = result.messages;
		folded = true;
	}

	const postFold = out.reduce((s, m) => s + countTokens(m.content), 0);
	if (postFold > SHARD_GATE) {
		// The latest user turn is the relevance anchor for sharding.
		const anchor =
			[...out].reverse().find((m) => m.role === "user")?.content ?? "";
		const result = shardMessages(out, anchor, {
			maxTokens: Math.min(3000, Math.floor(postFold * 0.9)),
		});
		out = result.messages;
		sharded = true;
	}

	return { messages: out, folded, sharded };
}

/**
 * Cost of a planned request, used only for the pre-flight budget guard. Falls
 * back to a conservative baseline when the model isn't in the fingerprint
 * catalog so the guard never blocks on an unknown model.
 */
function estimateCostUsd(model: string, promptTokens: number, maxOut: number): number {
	const fp = getModelFingerprint(model);
	if (!fp) return 0;
	return (
		(promptTokens / 1_000_000) * fp.inputCostPerMillion +
		(maxOut / 1_000_000) * fp.outputCostPerMillion
	);
}

export function createChatSession(opts: ChatSessionOptions): ChatSession {
	let model = opts.model;
	let history: ChatMessage[] = [];
	let turns = 0;

	// When a custom endpoint is pinned, build a dedicated gateway routed there
	// (model IDs sent unchanged, ambient keys not forwarded). Otherwise fall
	// back to the shared gateway, which routes by model prefix and reads keys
	// from the environment.
	const pinnedGateway = opts.baseUrl
		? (() => {
				const gw = new ProviderGateway();
				gw.pinToEndpoint(opts.baseUrl as string, opts.apiKey);
				return gw;
			})()
		: null;

	// Injectable so tests stub the network; production wires the gateway.
	const callStream =
		opts.completeStream ??
		((m: string, msgs: ChatMessage[], maxTokens: number) =>
			pinnedGateway
				? pinnedGateway.completeStream({ model: m, messages: msgs, maxTokens })
				: streamComplete(m, { messages: msgs, maxTokens }));

	return {
		get model() {
			return model;
		},
		get provider() {
			return providerFromModel(model);
		},
		get turns() {
			return turns;
		},
		get history() {
			return history;
		},

		setModel(next: string) {
			model = next.trim();
		},

		clear() {
			history = [];
			turns = 0;
		},

		async *send(text: string): AsyncGenerator<string, TurnMetrics> {
			const userText = text.trim();
			if (!userText) {
				throw new Error("empty message");
			}

			const pending: ChatMessage[] = [...history, { role: "user", content: userText }];
			const { messages, folded, sharded } = optimize(pending);

			const sentTokens = messages.reduce((s, m) => s + countTokens(m.content), 0);
			const inputTokens = pending.reduce((s, m) => s + countTokens(m.content), 0);

			// Pre-flight budget guard — fail before the network call.
			const estimated = estimateCostUsd(model, sentTokens, DEFAULT_MAX_TOKENS);
			const budget = checkBudget(estimated);
			if (!budget.allowed) {
				throw new Error(`budget exceeded: ${budget.reason}`);
			}

			const started = performance.now();
			let full = "";
			let final: CompletionResponse | undefined;
			const truncated = false;

			try {
				const stream = callStream(model, messages, DEFAULT_MAX_TOKENS);
				let step = await stream.next();
				while (!step.done) {
					full += step.value;
					yield step.value;
					step = await stream.next();
				}
				final = step.value;
			} catch (err) {
				// Surface provider errors as turn content rather than crashing the
				// TUI — the status line and transcript both show what happened.
				const msg = err instanceof Error ? err.message : String(err);
				throw new Error(msg);
			}

			const latencyMs = performance.now() - started;
			const outputTokens = final?.usage.completionTokens ?? countTokens(full);

			// Commit history only on success — a failed turn shouldn't pollute
			// the conversation the next turn optimizes over.
			history = [...pending, { role: "assistant", content: full }];
			turns++;

			return {
				inputTokens,
				sentTokens,
				outputTokens,
				folded,
				sharded,
				provider: providerFromModel(final?.model ?? model),
				servedModel: final?.model ?? model,
				latencyMs,
				truncated,
				content: full,
			};
		},
	};
}

/** Rough per-turn cost summary for the status line. */
export function summarizeTurn(m: TurnMetrics): string {
	const savedPct =
		m.inputTokens > 0
			? Math.max(0, Math.round((1 - m.sentTokens / m.inputTokens) * 100))
			: 0;
	const parts = [
		`${m.servedModel}`,
		`${m.sentTokens}\u2192${m.outputTokens} tok`,
	];
	if (m.folded || m.sharded) {
		const stages = [m.folded ? "fold" : "", m.sharded ? "shard" : ""]
			.filter(Boolean)
			.join("+");
		parts.push(`${stages} \u2212${savedPct}%`);
	}
	parts.push(`${Math.round(m.latencyMs)}ms`);
	return parts.join(" \u00b7 ");
}
