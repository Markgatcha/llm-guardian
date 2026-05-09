#!/usr/bin/env bun
// LLM-Guardian CLI - Commands: --start, --dash, --optimize
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
import { loadOpenRouterCatalog } from "../providers/openrouter-catalog.ts";
import { configure as configureProvider } from "../providers/openrouter-adapter.ts";
import { launchGuardianTui } from "../tui/index.ts";

// CLI definition

const program = new Command();

interface ServerOptions {
	port?: string;
	apiKey?: string;
	dailyBudget?: string;
	monthlyBudget?: string;
}

interface TuiOptions {
	apiUrl?: string;
	adminKey?: string;
	model?: string;
	refreshMs?: string;
	config?: string;
	continue?: boolean;
	session?: string;
	fork?: boolean;
	prompt?: string;
	agent?: string;
}

function parseRefreshMs(value?: string): number | undefined {
	if (typeof value !== "string") return undefined;
	const refreshMs = parseInt(value, 10);
	return Number.isFinite(refreshMs) ? refreshMs : undefined;
}

async function openGuardianConsole(opts: TuiOptions = {}): Promise<void> {
	await launchGuardianTui({
		apiUrl: opts.apiUrl,
		adminKey: opts.adminKey,
		model: opts.model,
		refreshMs: parseRefreshMs(opts.refreshMs),
		configPath: opts.config,
		continueLast: opts.continue,
		sessionId: opts.session,
		forkSession: opts.fork,
		prompt: opts.prompt,
		agent: opts.agent,
	});
}

async function startGuardianServer(opts: ServerOptions = {}): Promise<void> {
	const port = parseInt(opts.port ?? "3000", 10);

	if (opts.apiKey || process.env.OPENROUTER_API_KEY) {
		configureProvider({
			apiKey: opts.apiKey || process.env.OPENROUTER_API_KEY,
		});
	}
	configureBudget({
		dailyBudgetUsd: parseFloat(opts.dailyBudget ?? "50"),
		monthlyBudgetUsd: parseFloat(opts.monthlyBudget ?? "500"),
	});

	const app = new Hono();

	app.use("/*", cors());

	app.get("/health", (c) =>
		c.json({ status: "ok", version: "1.0.0", runtime: "bun" }),
	);

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

	app.get("/api/v1/logs", (c) => {
		const limit = parseInt(c.req.query("limit") || "100", 10);
		const offset = parseInt(c.req.query("offset") || "0", 10);
		return c.json(getRequestLog(limit, offset));
	});

	app.get("/api/v1/budget", (c) => c.json(getSpendSummary()));

	app.get("/api/v1/providers", async (c) => {
		const catalog = await loadOpenRouterCatalog(process.cwd());
		if (catalog.models.length > 0) {
			return c.json({
				models: catalog.models.map((model) => ({
					model: model.model,
					provider: model.provider,
					contextWindow: model.contextWindow,
					maxCompletionTokens: model.maxCompletionTokens,
					inputCostPerMillion: model.inputPerMillion,
					outputCostPerMillion: model.outputPerMillion,
					supportsToolUse: model.supportsTools,
					supportsVision: model.supportsVision,
					source: model.source,
					catalogUpdatedAt: model.catalogUpdatedAt,
					createdAt: model.createdAt,
				})),
				catalog: {
					source: "openrouter",
					fetchedAt: catalog.fetchedAt,
					fromCache: catalog.fromCache,
					stale: catalog.stale,
					error: catalog.error,
				},
			});
		}
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

	app.post("/api/v1/fold", async (c) => {
		const body = await c.req.json();
		const result = foldText(body.text || "", {
			maxTokens: body.maxTokens || 2000,
		});
		return c.json(result);
	});

	console.log(`
 Guardian server online
 http://localhost:${port}

 This process is the local API server. Open a second terminal and run:
 guardian
`);

	Bun.serve({
		port,
		fetch: app.fetch,
	});
}

program
	.name("guardian")
	.description(
		"LLM-Guardian - Zero-config token optimization with Semantic Folding",
	)
	.version("1.0.0")
	.option("--api-url <url>", "Use a remote Guardian API instead of local runtime")
	.option("--admin-key <key>", "Guardian admin API key")
	.option("--model <name>", "Default model for chat")
	.option("--agent <agent>", "Default agent: build, plan, audit, or fleet")
	.option("--continue", "Continue the latest Guardian session")
	.option("--session <id>", "Open a saved Guardian session")
	.option("--fork", "Fork the selected or latest session")
	.option("--prompt <text>", "Start Guardian and submit an initial prompt")
	.option("--refresh-ms <ms>", "Refresh interval in milliseconds")
	.option("--config <path>", "Path to .guardian/config.json")
	.action(openGuardianConsole);

// start

const startCommand = program
	.command("start")
	.description("Start Guardian services")
	.action(() => {
		console.log("Run `guardian` for the interactive CLI.");
		console.log("Run `guardian start server` for the local API server.");
	});

startCommand
	.command("server")
	.alias("api")
	.description("Start the local Guardian API server")
	.option("-p, --port <port>", "Port to listen on", "3000")
	.option("-k, --api-key <key>", "OpenRouter API key")
	.option("--daily-budget <usd>", "Daily budget limit in USD", "50")
	.option("--monthly-budget <usd>", "Monthly budget limit in USD", "500")
	.action(startGuardianServer);

program
	.command("server", { hidden: true })
	.description("Start the local Guardian API server")
	.option("-p, --port <port>", "Port to listen on", "3000")
	.option("-k, --api-key <key>", "OpenRouter API key")
	.option("--daily-budget <usd>", "Daily budget limit in USD", "50")
	.option("--monthly-budget <usd>", "Monthly budget limit in USD", "500")
	.action(startGuardianServer);

// dash

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

// optimize

program
	.command("optimize <text>")
	.description("Run Semantic Folding on text and show compression stats")
	.option("-t, --max-tokens <n>", "Max output tokens", "500")
	.action((text: string, opts) => {
		const maxTokens = parseInt(opts.maxTokens, 10);
		const result = foldText(text, { maxTokens });

		console.log(`\n Semantic Folding Results\n${"-".repeat(50)}`);
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
		console.log(`\n Folded Output\n${"-".repeat(50)}`);
		console.log(result.foldedPrompt);
		console.log("");
	});

// tui

program
	.command("tui")
	.description("Open the Guardian AI terminal console")
	.option("--api-url <url>", "Use a remote Guardian API instead of local runtime")
	.option("--admin-key <key>", "Guardian admin API key")
	.option("--model <name>", "Default model for chat")
	.option("--agent <agent>", "Default agent: build, plan, audit, or fleet")
	.option("--continue", "Continue the latest Guardian session")
	.option("--session <id>", "Open a saved Guardian session")
	.option("--fork", "Fork the selected or latest session")
	.option("--prompt <text>", "Start Guardian and submit an initial prompt")
	.option("--refresh-ms <ms>", "Refresh interval in milliseconds")
	.option("--config <path>", "Path to .guardian/config.json")
	.action(async (opts) => {
		const refreshMs =
			typeof opts.refreshMs === "string" ? parseInt(opts.refreshMs, 10) : undefined;
		await launchGuardianTui({
			apiUrl: opts.apiUrl,
			adminKey: opts.adminKey,
			model: opts.model,
			agent: opts.agent,
			refreshMs: Number.isFinite(refreshMs) ? refreshMs : undefined,
			configPath: opts.config,
			continueLast: opts.continue,
			sessionId: opts.session,
			forkSession: opts.fork,
			prompt: opts.prompt,
		});
	});

await program.parseAsync();

export default program;
