import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import {
	OPENROUTER_CATALOG_TTL_MS,
	loadOpenRouterCatalog,
	refreshOpenRouterCatalog,
} from "../../src/providers/openrouter-catalog.ts";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

function tempRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "guardian-openrouter-"));
	roots.push(root);
	return root;
}

function json(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

const modelsPayload = {
	data: [
		{
			id: "anthropic/claude-opus-4.7",
			created: 1_775_000_000,
			context_length: 400_000,
			pricing: {
				prompt: "0.000015",
				completion: "0.000075",
			},
			architecture: {
				input_modalities: ["text", "image"],
			},
			top_provider: {
				context_length: 300_000,
				max_completion_tokens: 64_000,
			},
			supported_parameters: ["tools", "reasoning"],
		},
	],
};

test("refreshOpenRouterCatalog normalizes prices, context, and capabilities", async () => {
	const root = tempRoot();
	const result = await refreshOpenRouterCatalog(root, async () => json(modelsPayload));

	expect(result.fromCache).toBe(false);
	expect(result.stale).toBe(false);
	expect(result.models[0].model).toBe("anthropic/claude-opus-4.7");
	expect(result.models[0].provider).toBe("anthropic");
	expect(result.models[0].inputPerMillion).toBe(15);
	expect(result.models[0].outputPerMillion).toBe(75);
	expect(result.models[0].contextWindow).toBe(300_000);
	expect(result.models[0].maxCompletionTokens).toBe(64_000);
	expect(result.models[0].supportsTools).toBe(true);
	expect(result.models[0].supportsVision).toBe(true);
});

test("loadOpenRouterCatalog uses fresh cache within four day window", async () => {
	const root = tempRoot();
	await refreshOpenRouterCatalog(root, async () => json(modelsPayload));

	let fetched = false;
	const result = await loadOpenRouterCatalog(root, {
		maxAgeMs: OPENROUTER_CATALOG_TTL_MS,
		fetcher: async () => {
			fetched = true;
			throw new Error("should not fetch");
		},
		now: Date.now(),
	});

	expect(fetched).toBe(false);
	expect(result.fromCache).toBe(true);
	expect(result.stale).toBe(false);
	expect(result.models[0].model).toBe("anthropic/claude-opus-4.7");
});

test("loadOpenRouterCatalog returns stale cache when refresh fails", async () => {
	const root = tempRoot();
	await refreshOpenRouterCatalog(root, async () => json(modelsPayload));

	const result = await loadOpenRouterCatalog(root, {
		maxAgeMs: -1,
		fetcher: async () => {
			throw new Error("offline");
		},
	});

	expect(result.fromCache).toBe(true);
	expect(result.stale).toBe(true);
	expect(result.error).toContain("offline");
	expect(result.models[0].model).toBe("anthropic/claude-opus-4.7");
});
