// LLM-Guardian CLI — Commands: --start, --dash, --optimize
// Bun-powered entry point for the Guardian nervous system

import { Command } from "commander";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { foldText } from "../core/folding-engine.ts";
import { getRequestLog, getStats, orchestrate } from "../core/orchestrator.ts";
import { buildRequestMemoryPack } from "../core/memos-memory-source.ts";
import type { GuardianRequest } from "../core/types.ts";
import {
	configure as configureBudget,
	getSpendSummary,
} from "../gateway/budget-manager.ts";
import { getAllFingerprints } from "../providers/fingerprints.ts";
import { configure as configureProvider } from "../providers/openrouter-adapter.ts";
import { renderSplash } from "./splash.ts";
import { theme } from "./theme.ts";
import * as ui from "./ui.ts";

/** Single source of truth for every version string the CLI prints. */
const VERSION = "1.6.26";

// ─── CLI Definition ──────────────────────────────────────────────────────────

const program = new Command();

program
	.name("guardian")
	.description(
		"LLM-Guardian — Zero-config token optimization with Semantic Folding",
	)
	.version(VERSION);

// ─── --start ─────────────────────────────────────────────────────────────────

program
	.command("start")
	.description("Start the Guardian API server")
	.option("-p, --port <port>", "Port to listen on", "3000")
	.option("-k, --api-key <key>", "OpenRouter API key")
	.option("--daily-budget <usd>", "Daily budget limit in USD", "50")
	.option("--monthly-budget <usd>", "Monthly budget limit in USD", "500")
	.option(
		"--base-url <url>",
		"Base URL for the chat/completions endpoint (any OpenAI-compatible). Use for local runtimes.",
	)
	.option(
		"--lm-studio",
		"Alias for --base-url http://127.0.0.1:1234/v1 with no API key (LM Studio local server).",
	)
	.option(
		"--local",
		"Alias for a local OpenAI-compatible runtime: skip the API key check.",
	)
	.option(
		"--no-reasoning",
		"Disable chain-of-thought on reasoning models (faster, deterministic). Sets GUARDIAN_REASONING=none; the local model answers directly.",
	)
	.action(async (opts) => {
		const port = parseInt(opts.port, 10);

		// Configure subsystems
		const useLocal = !!(opts.lmStudio || opts.local || opts.baseUrl);
		const resolvedBaseUrl = opts.lmStudio
			? "http://127.0.0.1:1234/v1"
			: opts.baseUrl || undefined;
		const resolvedApiKey =
			opts.apiKey || process.env.OPENROUTER_API_KEY || undefined;

		// Reasoning models (e.g. Gemma 4 E2B) emit CoT by default, which is
		// slow + non-deterministic. Default to OFF for local runs unless the
		// caller explicitly keeps it on.
		const reasoningEnabled = opts.noReasoning === false;
		const reasoning: { effort: "none" } | false = reasoningEnabled
			? { effort: "none" }
			: false;

		if (useLocal || resolvedApiKey) {
			configureProvider({
				apiKey: resolvedApiKey,
				baseUrl: resolvedBaseUrl,
				// Local runtimes (127.0.0.1 / localhost) never need a key.
				skipAuth: !!useLocal,
				reasoning,
			});
		}
		configureBudget({
			dailyBudgetUsd: parseFloat(opts.dailyBudget),
			monthlyBudgetUsd: parseFloat(opts.monthlyBudget),
		});

		const app = new Hono();

		// CORS
		app.use("/*", cors());

		// Health check
		app.get("/health", (c) =>
			c.json({ status: "ok", version: VERSION, runtime: "bun" }),
		);

		// OpenAI-compatible proxy
		app.post("/v1/chat/completions", async (c) => {
			try {
				const body = await c.req.json();
				// Derive the user query (last user message) for memory retrieval.
				const userMessages = (body.messages || []).filter(
					(m: { role?: string }) => m.role === "user",
				);
				const userQuery =
					(userMessages[userMessages.length - 1]?.content as string) ||
					"";
				// Auto-build a MemOS memory pack when not explicitly supplied via
				// `memory_pack`. buildRequestMemoryPack() is env-gated and fails
				// soft, so standalone guardian instances are unaffected.
				const requestedMax = body.max_tokens || body.maxTokens;
				const packBudget =
					typeof requestedMax === "number"
						? Math.min(1500, Math.max(400, requestedMax))
						: 1200;
				const memoryPack =
					body.memory_pack ||
					(await buildRequestMemoryPack(userQuery, packBudget)) ||
					undefined;

				const request: GuardianRequest = {
					model: body.model || "auto",
					messages: body.messages || [],
					temperature: body.temperature,
					maxTokens: body.max_tokens || body.maxTokens,
					stream: body.stream || false,
					tools: body.tools,
					enableFolding: body.enable_folding ?? true,
					enableSharding: body.enable_sharding ?? true,
					enableToolFusion: body.enable_tool_fusion ?? true,
					enableToolGating: body.enable_tool_gating ?? true,
					enablePromptCaching: body.enable_prompt_caching ?? true,
					memoryPack,
				};

				if (request.stream) {
					// Streaming response
					const encoder = new TextEncoder();
					const stream = new ReadableStream({
						async start(controller) {
							try {
								const { orchestrateStream } = await import(
									"../core/orchestrator.ts"
								);
								for await (const chunk of orchestrateStream(request)) {
									if (typeof chunk === "string") {
										const sseChunk = `data: ${JSON.stringify({
											choices: [{ delta: { content: chunk } }],
										})}\n\n`;
										controller.enqueue(encoder.encode(sseChunk));
									}
								}
								controller.enqueue(encoder.encode("data: [DONE]\n\n"));
								controller.close();
							} catch (err) {
								controller.error(err);
							}
						},
					});

					return new Response(stream, {
						headers: {
							"Content-Type": "text/event-stream",
							"Cache-Control": "no-cache",
							Connection: "keep-alive",
						},
					});
				}

				const response = await orchestrate(request);

				return c.json({
					id: response.id,
					object: "chat.completion",
					created: Math.floor(Date.now() / 1000),
					model: response.model,
					choices: [
						{
							index: 0,
							message: { role: "assistant", content: response.content },
							finish_reason: "stop",
						},
					],
					usage: {
						prompt_tokens: response.usage.promptTokens,
						completion_tokens: response.usage.completionTokens,
						total_tokens: response.usage.totalTokens,
					},
					guardian: {
						cost_usd: response.costUsd,
						baseline_cost_usd: response.baselineCostUsd,
						saved_usd: response.savedUsd,
						latency_ms: response.latencyMs,
						optimization: response.optimization,
					},
				});
			} catch (err) {
				const message = err instanceof Error ? err.message : "Unknown error";
				return c.json({ error: message }, 500);
			}
		});

		// Stats endpoint
		app.get("/api/v1/stats/summary", (c) => c.json(getStats()));
		app.get("/api/v1/stats/savings", (c) => {
			const stats = getStats();
			return c.json({
				totalSavedUsd: stats.totalSavedUsd,
				todaySavedUsd: stats.today.savedUsd,
				monthSavedUsd: stats.month.savedUsd,
				avgCompressionRatio: stats.avgCompressionRatio,
				totalTokensOptimized: stats.totalTokensOptimized,
			});
		});
		app.get("/api/v1/stats/compression", (c) => {
			const stats = getStats();
			return c.json({
				avgCompressionRatio: stats.avgCompressionRatio,
				totalTokensOptimized: stats.totalTokensOptimized,
			});
		});

		// Logs endpoint
		app.get("/api/v1/logs", (c) => {
			const limit = parseInt(c.req.query("limit") || "100", 10);
			const offset = parseInt(c.req.query("offset") || "0", 10);
			return c.json(getRequestLog(limit, offset));
		});

		// Budget endpoint
		app.get("/api/v1/budget", (c) => c.json(getSpendSummary()));

		// Providers endpoint
		app.get("/api/v1/providers", (c) => {
			const fps = getAllFingerprints();
			return c.json({
				models: fps.map((fp) => ({
					model: fp.modelName,
					provider: fp.provider,
					contextWindow: fp.contextWindow,
					inputCostPerMillion: fp.inputCostPerMillion,
					outputCostPerMillion: fp.outputCostPerMillion,
					supportsStreaming: fp.supportsStreaming,
					supportsVision: fp.supportsVision,
					supportsToolUse: fp.supportsToolUse,
				})),
			});
		});

		// Folding endpoint (standalone)
		app.post("/api/v1/fold", async (c) => {
			const body = await c.req.json();
			const result = foldText(body.text || "", {
				maxTokens: body.maxTokens || 2000,
			});
			return c.json(result);
		});

		// Startup banner — the same visual grammar as the splash, compacted to
		// a single slab so it doesn't clear the scrollback the server logs into.
		ui.blank();
		ui.wordmark("guardian");
		ui.blank();
		ui.panel([
			[
				["Serving", "bold"],
				[" · ", "faint"],
				[`http://localhost:${port}`, "text"],
				["  ", "faint"],
				[useLocal ? "local runtime" : "OpenRouter", "faint"],
			],
		]);
		ui.blank();
		ui.keys([
			["GET /health", "liveness"],
			["POST /v1/chat/completions", "proxy"],
		]);
		ui.blank();
		ui.tip("guardian dash", "to open the analytics dashboard");
		ui.blank();
		ui.footer(VERSION);
		ui.blank();

		Bun.serve({
			port,
			fetch: app.fetch,
		});
	});

// ─── --dash ──────────────────────────────────────────────────────────────────

program
	.command("dash")
	.description("Open the analytics dashboard")
	.option("-p, --port <port>", "Dashboard port", "5173")
	.action(async (opts) => {
		const port = parseInt(opts.port, 10);

		// Serve the built dashboard
		const dashboardDir = `${import.meta.dir}/../dashboard`;
		Bun.serve({
			port,
			async fetch(req) {
				const url = new URL(req.url);
				const filePath = url.pathname === "/" ? "/index.html" : url.pathname;

				// Try to serve the file
				const file = Bun.file(`${dashboardDir}${filePath}`);
				if (await file.exists()) {
					return new Response(file);
				}

				// SPA fallback
				const indexFile = Bun.file(`${dashboardDir}/index.html`);
				if (await indexFile.exists()) {
					return new Response(indexFile);
				}

				return new Response(
					"Dashboard not built. Run `bun run build:dashboard` first.",
					{
						status: 404,
					},
				);
			},
		});

		ui.blank();
		ui.wordmark("guardian");
		ui.blank();
		ui.panel([
			[
				["Dashboard", "bold"],
				[" \u00b7 ", "faint"],
				[`http://localhost:${port}`, "text"],
			],
		]);
		ui.blank();
		ui.tip("guardian start", "to feed it live traffic");
		ui.blank();
		ui.footer(VERSION);
		ui.blank();
	});

// ─── --optimize ──────────────────────────────────────────────────────────────

program
	.command("optimize <text>")
	.description("Run Semantic Folding on text and show compression stats")
	.option("-t, --max-tokens <n>", "Max output tokens", "500")
	.action((text: string, opts) => {
		const maxTokens = parseInt(opts.maxTokens, 10);
		const result = foldText(text, { maxTokens });
		const m = result.metadata;

		// Headline result goes in the slab — same grammar as the splash's
		// status line — with the detail table below it in the inline grammar.
		//
		// Note on the percentage: `compressionRatio` is folded/original (the
		// fraction RETAINED), so the reduction the user cares about is its
		// complement. Reporting the raw ratio as "smaller" would invert it.
		const reductionPct = (1 - m.compressionRatio) * 100;
		ui.blank();
		ui.panel([
			[
				["Folded", "bold"],
				[" \u00b7 ", "faint"],
				[`${m.originalTokens} \u2192 ${m.foldedTokens} tokens`, "text"],
				["  ", "faint"],
				[`${reductionPct.toFixed(1)}% smaller`, "faint"],
			],
		]);
		ui.blank();
		ui.stat(
			"semantic density",
			`${(m.semanticDensity * 100).toFixed(1)}%`,
			theme.info,
		);
		ui.stat("folding time", `${result.foldingTimeMs.toFixed(2)}ms`);
		ui.stat("entities", m.entities.join(", ") || "none");
		ui.stat("actions", m.actions.join(", ") || "none");
		ui.stat("headline", m.headline || "none");
		ui.blank();
		ui.rule();
		ui.blank();
		console.log(result.foldedPrompt);
		ui.blank();
	});

// ─── Parse ───────────────────────────────────────────────────────────────────

// A bare `guardian` with no subcommand mounts the interactive TUI rather than
// dumping commander's usage text. Any actual command falls through to
// commander. The TUI is imported lazily so `guardian start` never pays the cost
// of loading the renderer or its native library.
//
// The starting model comes from GUARDIAN_MODEL, defaulting to Claude Sonnet via
// the Anthropic route (which the gateway proxies through OpenRouter). `/model`
// switches it at runtime.
if (process.argv.length <= 2) {
	const startModel =
		process.env.GUARDIAN_MODEL || "anthropic/claude-sonnet-4-5";
	if (process.stdout.isTTY) {
		const { runTui } = await import("./tui.ts");
		await runTui({
			version: VERSION,
			model: startModel,
			provider: process.env.OPENROUTER_API_KEY ? "OpenRouter" : "not connected",
		});
	} else {
		// Piped or redirected: a live renderer has nothing to attach to, so
		// print the static splash frame instead. Keeps `guardian | head` and CI
		// logs useful rather than erroring on a missing TTY.
		renderSplash({
			version: VERSION,
			provider: process.env.OPENROUTER_API_KEY ? "OpenRouter" : "not connected",
			tipCommand: process.env.OPENROUTER_API_KEY
				? "guardian start"
				: "guardian start --lm-studio",
			tipText: process.env.OPENROUTER_API_KEY
				? "to launch the gateway and start saving tokens"
				: "to connect a local runtime and start saving tokens",
		});
	}
} else {
	program.parse();
}

export default program;
