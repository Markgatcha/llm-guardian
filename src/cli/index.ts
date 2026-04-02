// LLM-Guardian CLI — Commands: --start, --dash, --optimize
// Bun-powered entry point for the Guardian nervous system

import { Command } from "commander";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { foldText } from "../core/folding-engine.ts";
import { getRequestLog, getStats, orchestrate } from "../core/orchestrator.ts";
import type { GuardianRequest } from "../core/types.ts";
import {
	configure as configureBudget,
	getSpendSummary,
} from "../gateway/budget-manager.ts";
import { getAllFingerprints } from "../providers/fingerprints.ts";
import { configure as configureProvider } from "../providers/openrouter-adapter.ts";

// ─── CLI Definition ──────────────────────────────────────────────────────────

const program = new Command();

program
	.name("guardian")
	.description(
		"LLM-Guardian — Zero-config token optimization with Semantic Folding",
	)
	.version("1.0.0");

// ─── --start ─────────────────────────────────────────────────────────────────

program
	.command("start")
	.description("Start the Guardian API server")
	.option("-p, --port <port>", "Port to listen on", "3000")
	.option("-k, --api-key <key>", "OpenRouter API key")
	.option("--daily-budget <usd>", "Daily budget limit in USD", "50")
	.option("--monthly-budget <usd>", "Monthly budget limit in USD", "500")
	.action(async (opts) => {
		const port = parseInt(opts.port, 10);

		// Configure subsystems
		if (opts.apiKey || process.env.OPENROUTER_API_KEY) {
			configureProvider({
				apiKey: opts.apiKey || process.env.OPENROUTER_API_KEY,
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
			c.json({ status: "ok", version: "1.0.0", runtime: "bun" }),
		);

		// OpenAI-compatible proxy
		app.post("/v1/chat/completions", async (c) => {
			try {
				const body = await c.req.json();
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

		console.log(`
 ╔══════════════════════════════════════════════╗
 ║  LLM-Guardian v1.0.0                        ║
 ║  Nervous System Online                      ║
 ║  http://localhost:${port}                      ║
 ╚══════════════════════════════════════════════╝
    `);

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
		console.log(`Starting Guardian Dashboard on http://localhost:${port}...`);

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

		console.log(`Dashboard: http://localhost:${port}`);
	});

// ─── --optimize ──────────────────────────────────────────────────────────────

program
	.command("optimize <text>")
	.description("Run Semantic Folding on text and show compression stats")
	.option("-t, --max-tokens <n>", "Max output tokens", "500")
	.action((text: string, opts) => {
		const maxTokens = parseInt(opts.maxTokens, 10);
		const result = foldText(text, { maxTokens });

		console.log(`\n Semantic Folding Results\n${"─".repeat(50)}`);
		console.log(`Original tokens:  ${result.metadata.originalTokens}`);
		console.log(`Folded tokens:    ${result.metadata.foldedTokens}`);
		console.log(
			`Compression:      ${(result.metadata.compressionRatio * 100).toFixed(1)}%`,
		);
		console.log(
			`Semantic density: ${(result.metadata.semanticDensity * 100).toFixed(1)}%`,
		);
		console.log(`Folding time:     ${result.foldingTimeMs.toFixed(2)}ms`);
		console.log(
			`Entities:         ${result.metadata.entities.join(", ") || "none"}`,
		);
		console.log(
			`Actions:          ${result.metadata.actions.join(", ") || "none"}`,
		);
		console.log(`Headline:         ${result.metadata.headline || "none"}`);
		console.log(`\n Folded Output\n${"─".repeat(50)}`);
		console.log(result.foldedPrompt);
		console.log("");
	});

// ─── Parse ───────────────────────────────────────────────────────────────────

program.parse();

export default program;
