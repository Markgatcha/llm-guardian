import { afterEach, expect, test } from "bun:test";
import { GuardianApiClient } from "../../src/tui/api-client.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function json(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

test("snapshot returns a disconnected state when health cannot be reached", async () => {
	globalThis.fetch = async () => {
		throw new Error("offline");
	};

	const snapshot = await new GuardianApiClient("http://localhost:3000").snapshot();

	expect(snapshot.connected).toBe(false);
	expect(snapshot.message).toContain("offline");
	expect(snapshot.stats.totalRequests).toBe(0);
});

test("snapshot normalizes Guardian API payloads", async () => {
	globalThis.fetch = async (input) => {
		const url = String(input);
		if (url.endsWith("/health")) return json({ status: "ok" });
		if (url.includes("/stats/summary")) {
			return json({
				total_requests: 2,
				total_cost_usd: 0.02,
				total_saved_usd: 0.18,
				baseline_cost_usd: 0.2,
				avg_latency_ms: 123,
				cache_hit_rate: 0.5,
				today: { request_count: 1, total_cost_usd: 0.01, saved_usd: 0.09 },
				last_30_days: { request_count: 2, total_cost_usd: 0.02, saved_usd: 0.18 },
			});
		}
		if (url.includes("/logs")) {
			return json({
				items: [
					{
						id: "req-1",
						model: "auto",
						provider: "openrouter",
						prompt_tokens: 10,
						completion_tokens: 5,
						cost_usd: 0.01,
						baseline_cost_usd: 0.1,
						saved_usd: 0.09,
						latency_ms: 50,
						status: "ok",
						cache_hit: true,
					},
				],
			});
		}
		if (url.includes("/providers")) {
			return json({
				providers: [
					{
						provider: "openrouter",
						models: [
							{
								model: "model-a",
								pricing: { input_per_million: 1, output_per_million: 2 },
								p95_latency_ms: 75,
							},
						],
					},
				],
			});
		}
		if (url.includes("/rules")) {
			return json({
				rules: [
					{
						id: "rule-1",
						name: "Budget cap",
						rule_type: "budget_cap",
						priority: 100,
						is_active: true,
					},
				],
			});
		}
		if (url.includes("/budget")) {
			return json({
				dailySpentUsd: 0.01,
				dailyLimitUsd: 10,
				monthlySpentUsd: 0.02,
				monthlyLimitUsd: 100,
			});
		}
		return json({}, 404);
	};

	const snapshot = await new GuardianApiClient("http://localhost:3000", "key").snapshot();

	expect(snapshot.connected).toBe(true);
	expect(snapshot.stats.totalRequests).toBe(2);
	expect(snapshot.stats.totalSavedUsd).toBe(0.18);
	expect(snapshot.logs[0].cacheHit).toBe(true);
	expect(snapshot.providers[0].inputPerMillion).toBe(1);
	expect(snapshot.rules[0].ruleType).toBe("budget_cap");
	expect(snapshot.budget.monthlyLimitUsd).toBe(100);
});

test("chat sends optimization flags and normalizes model responses", async () => {
	let postedBody: Record<string, unknown> = {};
	let postedHeaders: Headers | undefined;
	globalThis.fetch = async (_input, init) => {
		postedBody = JSON.parse(String(init?.body));
		postedHeaders = new Headers(init?.headers);
		return json({
			model: "auto-selected",
			choices: [
				{
					message: {
						content: "Use the cheaper routed model.",
					},
				},
			],
			guardian: {
				cost_usd: 0.002,
				saved_usd: 0.011,
				latency_ms: 80,
				optimization: {
					totalTokensSaved: 1200,
				},
			},
		});
	};

	const result = await new GuardianApiClient("http://localhost:3000", "key").chat(
		[{ role: "user", content: "hello" }],
		"auto",
	);

	expect(postedHeaders?.get("X-Guardian-Key")).toBe("key");
	expect(postedBody.model).toBe("auto");
	expect(postedBody.enable_folding).toBe(true);
	expect(postedBody.enable_sharding).toBe(true);
	expect(postedBody.enable_tool_fusion).toBe(true);
	expect(result.content).toBe("Use the cheaper routed model.");
	expect(result.model).toBe("auto-selected");
	expect(result.savedUsd).toBe(0.011);
	expect(result.tokensSaved).toBe(1200);
});

test("foldText posts to the local folding endpoint", async () => {
	let postedBody: Record<string, unknown> = {};
	globalThis.fetch = async (_input, init) => {
		postedBody = JSON.parse(String(init?.body));
		return json({
			foldedPrompt: "compressed",
			foldingTimeMs: 12,
			metadata: {
				originalTokens: 100,
				foldedTokens: 40,
				compressionRatio: 0.4,
				semanticDensity: 0.9,
				entities: ["Guardian"],
				actions: ["route"],
				headline: "Cost-aware route",
			},
		});
	};

	const result = await new GuardianApiClient("http://localhost:3000").foldText(
		"long prompt",
		500,
	);

	expect(postedBody.text).toBe("long prompt");
	expect(postedBody.maxTokens).toBe(500);
	expect(result.foldedPrompt).toBe("compressed");
	expect(result.metadata.foldedTokens).toBe(40);
	expect(result.metadata.entities).toEqual(["Guardian"]);
});
