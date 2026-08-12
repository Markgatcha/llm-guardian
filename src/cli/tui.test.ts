// Interactive TUI tests — the chat surface.
//
// These run against the library's own test renderer, which drives the real
// layout engine and real native frame composition, with the completion stream
// stubbed via an injected session factory — so they run offline and
// deterministically.
//
// The properties worth locking:
//   1. Reflow — the composition tracks the viewport on resize.
//   2. Painting — the slab fill, hairline bar, ramp, and amber tip are painted
//      from the design tokens (verified via span capture, since a fill-defined
//      panel is invisible to the char frame).
//   3. Behavior — a prompt streams a reply into the transcript, /model switches
//      the active model, /clear resets, and Ctrl+C/Escape quit.

import { describe, expect, it } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import type { ChatMessage, CompletionResponse } from "../core/types.ts";
import { palette } from "./theme.ts";
import { mountTui, isQuitKey } from "./tui.ts";

/** A canned streaming reply. */
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

/** Mount the TUI into a test renderer with a stubbed chat session. */
async function harness(
	width = 100,
	height = 30,
	chunks: string[] = ["The migration timed out. Raise the timeout to 120s."],
) {
	const setup = await createTestRenderer({ width, height });
	const { createChatSession } = await import("./chat-session.ts");
	const handles = mountTui(setup.renderer, {
		version: "9.9.9",
		createSession: (model) => createChatSession({ model, completeStream: stubStream(chunks) }),
	});
	await setup.renderOnce();
	return { ...setup, ...handles };
}

/** `#rrggbb` for a captured span color. */
function hex(c: { r: number; g: number; b: number }): string {
	return `#${[c.r, c.g, c.b]
		.map((v) => Math.round(v * 255).toString(16).padStart(2, "0"))
		.join("")}`;
}

/** Count cells by color across a captured frame. */
function colorCounts(setup: Awaited<ReturnType<typeof harness>>) {
	const bg = new Map<string, number>();
	const fg = new Map<string, number>();
	// biome-ignore lint/suspicious/noExplicitAny: the capture shape is untyped
	const lines: any[] = (setup.captureSpans() as any).lines ?? [];
	for (const line of lines) {
		for (const span of line?.spans ?? []) {
			const len = span.text?.length ?? 1;
			if (span.bg) bg.set(hex(span.bg), (bg.get(hex(span.bg)) ?? 0) + len);
			if (span.fg) fg.set(hex(span.fg), (fg.get(hex(span.fg)) ?? 0) + len);
		}
	}
	return { bg, fg };
}

describe("tui layout", () => {
	it("renders the wordmark, prompt, hints, tip, and footer", async () => {
		const h = await harness();
		const frame = h.captureCharFrame();

		expect(frame).toContain("Message guardian");
		expect(frame).toContain("claude-sonnet-4-5");
		expect(frame).toContain("enter send");
		expect(frame).toContain("/model");
		expect(frame).toContain("9.9.9");
		expect(frame).toMatch(/[\u2580\u2584\u2588]/);

		h.renderer.destroy();
	});

	it("draws no box-drawing characters — panels are fills only", async () => {
		const h = await harness();
		expect(h.captureCharFrame()).not.toMatch(/[┌┐└┘├┤┬┴┼─│╔╗╚╝═║]/);
		h.renderer.destroy();
	});

	it("hides the transcript until the first turn", async () => {
		const h = await harness();
		expect(h.transcript.visible).toBe(false);
		h.renderer.destroy();
	});
});

describe("tui painting", () => {
	it("paints the slab fill and its hairline bar", async () => {
		const h = await harness(100, 30);
		const { bg } = colorCounts(h);
		expect(bg.get(palette.surface)).toBeGreaterThan(100);
		expect(bg.get(palette.surfaceBar)).toBe(5);
		expect(bg.get(palette.background)).toBeGreaterThan(1000);
		h.renderer.destroy();
	});

	it("uses amber for the provider tip", async () => {
		const h = await harness(100, 30);
		const { fg } = colorCounts(h);
		expect(fg.get(palette.amber)).toBeGreaterThan(5);
		h.renderer.destroy();
	});
});

describe("tui reflow", () => {
	it("resizes the slab when the terminal resizes", async () => {
		const h = await harness(100, 30);
		expect(h.slab.width).toBe(47);

		h.resize(140, 40);
		await h.renderOnce();
		expect(h.slab.width).toBe(66);

		h.renderer.destroy();
	});

	it("still renders every element after a resize", async () => {
		const h = await harness(100, 30);
		h.resize(120, 36);
		await h.renderOnce();
		const frame = h.captureCharFrame();
		expect(frame).toContain("Message guardian");
		expect(frame).toContain("9.9.9");
		h.renderer.destroy();
	});
});

describe("tui chat", () => {
	it("streams a reply into the transcript and shows turn metrics", async () => {
		const h = await harness();
		h.input.value = "why is the deploy failing";
		await h.submit();
		await h.renderOnce();

		const frame = h.captureCharFrame();
		// The user turn and the streamed assistant reply are both in the transcript.
		expect(frame).toContain("you \u203a why is the deploy failing");
		expect(frame).toContain("anthropic \u203a The migration timed out");
		// The status line now carries the turn summary.
		expect(frame).toMatch(/tok/);
		expect(h.transcript.visible).toBe(true);

		h.renderer.destroy();
	});

	it("/model switches the active model and provider", async () => {
		const h = await harness();
		h.input.value = "/model openai/gpt-4o";
		await h.submit();
		await h.renderOnce();

		expect(h.session.model).toBe("openai/gpt-4o");
		expect(h.session.provider).toBe("openai");
		expect(h.captureCharFrame()).toContain("openai/gpt-4o");

		h.renderer.destroy();
	});

	it("/model with no argument shows the current model", async () => {
		const h = await harness();
		h.input.value = "/model";
		await h.submit();
		await h.renderOnce();

		expect(h.captureCharFrame()).toContain("current model");
		h.renderer.destroy();
	});

	it("/clear empties the transcript and history", async () => {
		const h = await harness();
		h.input.value = "a real question about the database";
		await h.submit();
		await h.renderOnce();
		expect(h.session.turns).toBe(1);

		h.input.value = "/clear";
		await h.submit();
		await h.renderOnce();

		expect(h.session.turns).toBe(0);
		// `getChildrenCount` is cumulative on this renderer, so assert the live
		// child list is empty instead.
		expect(h.transcript.getChildren()).toHaveLength(0);
		expect(h.transcript.visible).toBe(false);

		h.renderer.destroy();
	});

	it("surfaces a provider error as a transcript line, not a crash", async () => {
		const setup = await createTestRenderer({ width: 100, height: 30 });
		const { createChatSession } = await import("./chat-session.ts");
		const failing = async function* (): AsyncGenerator<
			string,
			CompletionResponse
		> {
			// Yield once so this is a real generator, then throw as the provider
			// would on an auth failure.
			yield "";
			throw new Error("OpenRouter API error 401: invalid key");
		};
		const h = mountTui(setup.renderer, {
			version: "9.9.9",
			createSession: (model) =>
				createChatSession({ model, completeStream: failing }),
		});
		await setup.renderOnce();

		h.input.value = "hello";
		await h.submit();
		await setup.renderOnce();

		const frame = setup.captureCharFrame();
		expect(frame).toContain("error: OpenRouter API error 401");

		setup.renderer.destroy();
	});
});

describe("tui exit", () => {
	it("quits on ctrl+c and escape, and nothing else", () => {
		expect(isQuitKey({ name: "c", ctrl: true })).toBe(true);
		expect(isQuitKey({ name: "escape", ctrl: false })).toBe(true);
		expect(isQuitKey({ name: "c", ctrl: false })).toBe(false);
		expect(isQuitKey({ name: "return", ctrl: false })).toBe(false);
	});
});
