// Model-picker tests — the `/models` overlay.
//
// Runs against the library's test renderer with an injected (offline) model
// source, so no network is touched. The completion stream is irrelevant here —
// the picker only needs a session to hand a selection to, which the harness
// stubs the same way tui.test.ts does.
//
// What's locked down:
//   1. Open/close lifecycle — `/models` mounts the overlay, Escape closes it.
//   2. Filtering — typing narrows the visible rows by id/name/provider.
//   3. Navigation — arrow keys move the highlight, wrapping at the ends.
//   4. Selection — Enter commits the highlighted model into the session.
//   5. Escape does NOT quit the TUI (the picker consumes it).

import { describe, expect, it } from "bun:test";
import { createTestRenderer, createMockKeys } from "@opentui/core/testing";
import type { ChatMessage, CompletionResponse } from "../core/types.ts";
import { mountTui } from "./tui.ts";
import type { ModelListing } from "./model-picker.ts";

/** A canned streaming reply — the picker never sends, but the session needs one. */
function stubStream(
	chunks: string[],
): (
	m: string,
	msgs: ChatMessage[],
	maxTokens: number,
) => AsyncGenerator<string, CompletionResponse> {
	return async function* (m) {
		for (const c of chunks) yield c;
		return {
			id: "r",
			model: m,
			content: chunks.join(""),
			usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
			finishReason: "stop",
		};
	};
}

/** A small, deterministic offline catalog spanning three providers. */
const CATALOG: ModelListing[] = [
	{
		id: "anthropic/claude-sonnet-4-5",
		name: "Claude Sonnet 4.5",
		provider: "anthropic",
		inputCostPerMillion: 3,
		outputCostPerMillion: 15,
		contextWindow: 200_000,
		supportsTools: true,
	},
	{
		id: "openai/gpt-5.5",
		name: "GPT-5.5",
		provider: "openai",
		inputCostPerMillion: 5,
		outputCostPerMillion: 20,
		contextWindow: 400_000,
		supportsTools: true,
	},
	{
		id: "google/gemini-3.1-flash",
		name: "Gemini 3.1 Flash",
		provider: "google",
		inputCostPerMillion: 0.3,
		outputCostPerMillion: 2.5,
		contextWindow: 1_000_000,
		supportsTools: true,
	},
];

/** Mount the TUI with an offline model source and a stubbed chat session. */
async function harness(width = 100, height = 30) {
	const setup = await createTestRenderer({ width, height });
	const { createChatSession } = await import("./chat-session.ts");
	const handles = mountTui(setup.renderer, {
		version: "9.9.9",
		createSession: (model) =>
			createChatSession({ model, completeStream: stubStream(["ok"]) }),
		listModels: async () => CATALOG,
	});
	await setup.renderOnce();
	const keys = createMockKeys(setup.renderer);
	return { ...setup, ...handles, keys };
}

/** Open the picker by submitting the `/models` command, then settle. */
async function openPicker(h: Awaited<ReturnType<typeof harness>>) {
	h.input.value = "/models";
	await h.submit();
	// Let the injected listModels promise resolve and the options rebuild.
	await new Promise((r) => setTimeout(r, 0));
	await h.renderOnce();
}

describe("model picker lifecycle", () => {
	it("opens on /models and lists every catalog model", async () => {
		const h = await harness();
		expect(h.picker.isOpen()).toBe(false);

		await openPicker(h);
		expect(h.picker.isOpen()).toBe(true);
		expect(h.picker.models()).toHaveLength(3);

		const frame = h.captureCharFrame();
		expect(frame).toContain("select a model");
		expect(frame).toContain("anthropic/claude-sonnet-4-5");
		expect(frame).toContain("openai/gpt-5.5");
		expect(frame).toContain("google/gemini-3.1-flash");

		h.renderer.destroy();
	});

	it("closes on Escape without changing the model", async () => {
		const h = await harness();
		const before = h.session.model;
		await openPicker(h);
		expect(h.picker.isOpen()).toBe(true);

		h.keys.pressEscape();
		// A lone ESC byte is ambiguous (it could start a CSI sequence), so the
		// parser flushes it as a standalone Escape asynchronously — give it a
		// tick before asserting.
		await new Promise((r) => setTimeout(r, 20));
		await h.renderOnce();

		expect(h.picker.isOpen()).toBe(false);
		expect(h.session.model).toBe(before);
		h.renderer.destroy();
	});
});

describe("model picker filtering", () => {
	it("narrows the list as the user types", async () => {
		const h = await harness();
		await openPicker(h);
		expect(h.picker.visibleModels()).toHaveLength(3);

		await h.keys.typeText("gemini");
		await h.renderOnce();

		expect(h.picker.filter()).toBe("gemini");
		const visible = h.picker.visibleModels();
		expect(visible).toHaveLength(1);
		expect(visible[0].id).toBe("google/gemini-3.1-flash");

		h.renderer.destroy();
	});

	it("backspace widens the filter again", async () => {
		const h = await harness();
		await openPicker(h);

		await h.keys.typeText("gpt");
		await h.renderOnce();
		expect(h.picker.visibleModels()).toHaveLength(1);

		h.keys.pressBackspace();
		h.keys.pressBackspace();
		h.keys.pressBackspace();
		await h.renderOnce();
		expect(h.picker.filter()).toBe("");
		expect(h.picker.visibleModels()).toHaveLength(3);

		h.renderer.destroy();
	});

	it("matches on provider name, not just model id", async () => {
		const h = await harness();
		await openPicker(h);

		await h.keys.typeText("anthropic");
		await h.renderOnce();
		const visible = h.picker.visibleModels();
		expect(visible).toHaveLength(1);
		expect(visible[0].provider).toBe("anthropic");

		h.renderer.destroy();
	});
});

describe("model picker selection", () => {
	it("Enter commits the highlighted model into the session", async () => {
		const h = await harness();
		await openPicker(h);

		// First row is highlighted by default — that's the Anthropic model.
		h.keys.pressEnter();
		await h.renderOnce();

		expect(h.picker.isOpen()).toBe(false);
		expect(h.session.model).toBe("anthropic/claude-sonnet-4-5");
		expect(h.session.provider).toBe("anthropic");
		h.renderer.destroy();
	});

	it("arrow-down then Enter selects the second model", async () => {
		const h = await harness();
		await openPicker(h);

		h.keys.pressArrow("down");
		await h.renderOnce();
		h.keys.pressEnter();
		await h.renderOnce();

		expect(h.session.model).toBe("openai/gpt-5.5");
		expect(h.session.provider).toBe("openai");
		h.renderer.destroy();
	});

	it("arrow keys wrap around the list", async () => {
		const h = await harness();
		await openPicker(h);

		// Up from the first row wraps to the last row.
		h.keys.pressArrow("up");
		await h.renderOnce();
		h.keys.pressEnter();
		await h.renderOnce();

		expect(h.session.model).toBe("google/gemini-3.1-flash");
		h.renderer.destroy();
	});

	it("selecting a filtered result picks the filtered model", async () => {
		const h = await harness();
		await openPicker(h);

		await h.keys.typeText("gpt");
		await h.renderOnce();
		h.keys.pressEnter();
		await h.renderOnce();

		expect(h.session.model).toBe("openai/gpt-5.5");
		h.renderer.destroy();
	});
});
