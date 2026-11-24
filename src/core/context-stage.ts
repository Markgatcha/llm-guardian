// Extract-then-fold: the one place the "shrink big context" stage is defined.
//
// The chat session, the streaming and non-streaming orchestrator paths, and
// the benchmarks all need the same ordering, and hand-copied pipelines had
// already drifted apart. Order matters:
//
//   1. extract  — query-aware cut of any large paste (keeps what the final
//                 question is about; see ./query-extractor.ts)
//   2. fold     — query-blind compression of everything ELSE. Extracted
//                 messages are exempt: they were just cut to a deliberate
//                 budget, and folding them again would throw away the very
//                 lines extraction chose.
//
// The final user turn is never folded; it is the question.

import { foldMessages } from "./folding-engine.ts";
import { extractLargeBlobs } from "./query-extractor.ts";
import { estimateTokens } from "./token-counter.ts";
import type { ChatMessage } from "./types.ts";

export type ContextStageOptions = {
	/** Fold only if the non-extracted messages exceed this many tokens. */
	foldGate: number;
	/** Per-call fold budget passed to the folding engine. */
	foldMaxTokens?: number;
};

export type ContextStageResult = {
	messages: ChatMessage[];
	extracted: boolean;
	folded: boolean;
	foldingTimeMs: number;
};

const total = (ms: readonly ChatMessage[]) =>
	ms.reduce((s, m) => s + estimateTokens(m.content), 0);

export function extractThenFold(
	messages: ChatMessage[],
	opts: ContextStageOptions,
): ContextStageResult {
	const started = performance.now();
	const blobs = extractLargeBlobs(messages);
	let out = blobs.messages;
	let folded = false;

	const foldable = (i: number) => !blobs.indices.has(i);
	const foldableTokens = out.reduce(
		(s, m, i) => s + (foldable(i) ? estimateTokens(m.content) : 0),
		0,
	);

	if (foldableTokens > opts.foldGate) {
		const result = foldMessages(out, {
			maxTokens: opts.foldMaxTokens,
			preserveSystem: true,
			preserveLastUser: true,
		});
		const before = out;
		out = result.messages.map((m, i) => (foldable(i) ? m : (before[i] as ChatMessage)));
		folded = true;
	}

	return {
		messages: out,
		extracted: blobs.extracted > 0,
		folded,
		foldingTimeMs: performance.now() - started,
	};
}

export { total as totalTokens };
