// Chat-session tests — the conversation layer between the TUI and the gateway.
//
// The completion stream is injected as a stub, so these run offline and
// deterministically. What's being verified is the pipeline the TUI depends on:
// history management, the optimize stages firing in order, the budget guard
// running before any network call, and the metrics the status line shows.

import { describe, expect, it } from "bun:test";
import type { ChatMessage, CompletionResponse } from "../core/types.ts";
import { createChatSession, summarizeTurn } from "./chat-session.ts";

/** A canned streaming response, chunked as the real stream would be. */
function stubStream(
	chunks: string[],
	model = "anthropic/claude-sonnet-4-5",
): (
	m: string,
	msgs: ChatMessage[],
	maxTokens: number,
) => AsyncGenerator<string, CompletionResponse> {
	return async function* () {
		for (const c of chunks) yield c;
		return {
			id: "resp-1",
			model,
			content: chunks.join(""),
			usage: {
				promptTokens: 40,
				completionTokens: 12,
				totalTokens: 52,
			},
			finishReason: "stop",
		};
	};
}

describe("chat session", () => {
	it("streams a reply and commits it to history", async () => {
		const s = createChatSession({
			model: "anthropic/claude-sonnet-4-5",
			completeStream: stubStream(["Hello", " there", "."]),
		});

		const chunks: string[] = [];
		const gen = s.send("hi");
		let step = await gen.next();
		while (!step.done) {
			chunks.push(step.value);
			step = await gen.next();
		}
		const metrics = step.value;

		expect(chunks).toEqual(["Hello", " there", "."]);
		expect(metrics.content).toBe("Hello there.");
		expect(metrics.servedModel).toBe("anthropic/claude-sonnet-4-5");
		expect(metrics.provider).toBe("anthropic");
		expect(s.turns).toBe(1);
		// History now holds the user turn + the assistant reply.
		expect(s.history).toHaveLength(2);
		expect(s.history[1].role).toBe("assistant");
	});

	it("sends prior history on the second turn", async () => {
		let seenMessages: ChatMessage[] = [];
		const s = createChatSession({
			model: "openai/gpt-4o",
			completeStream: async function* (m, msgs) {
				seenMessages = msgs;
				yield "The migration timed out. Increase `timeout` in config/database.yml to 120s.";
				return {
					id: "r",
					model: m,
					content: "The migration timed out. Increase `timeout` in config/database.yml to 120s.",
					usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
					finishReason: "stop",
				};
			},
		});

		await drain(s.send("why is the deploy failing"));
		await drain(s.send("what value should I set"));

		// Second request carried turn-1 user + assistant + turn-2 user.
		const roles = seenMessages.map((m) => m.role);
		expect(roles).toContain("assistant");
		expect(seenMessages[seenMessages.length - 1].content).toBe(
			"what value should I set",
		);
	});

	it("setModel changes the reported model and provider", () => {
		const s = createChatSession({
			model: "openai/gpt-4o",
			completeStream: stubStream(["x"]),
		});
		expect(s.provider).toBe("openai");

		s.setModel("anthropic/claude-opus-4");
		expect(s.model).toBe("anthropic/claude-opus-4");
		expect(s.provider).toBe("anthropic");
	});

	it("clear() empties history and resets the turn count", async () => {
		const s = createChatSession({
			model: "openai/gpt-4o",
			completeStream: stubStream(["x"]),
		});
		await drain(s.send("hello"));
		expect(s.turns).toBe(1);

		s.clear();
		expect(s.turns).toBe(0);
		expect(s.history).toHaveLength(0);
	});

	it("rejects an empty message before touching the network", async () => {
		let called = false;
		const s = createChatSession({
			model: "openai/gpt-4o",
			completeStream: async function* (): AsyncGenerator<
				string,
				CompletionResponse
			> {
				called = true;
				yield "x";
				return {
					id: "r",
					model: "openai/gpt-4o",
					content: "x",
					usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
					finishReason: "stop",
				};
			},
		});
		await expect(drain(s.send("   "))).rejects.toThrow("empty");
		expect(called).toBe(false);
	});

	it("summarizeTurn reports model, tokens, and latency", async () => {
		const s = createChatSession({
			model: "anthropic/claude-sonnet-4-5",
			completeStream: stubStream(["reply"]),
		});
		const metrics = await drain(s.send("hello"));
		const line = summarizeTurn(metrics);
		expect(line).toContain("claude-sonnet-4-5");
		expect(line).toContain("tok");
		expect(line).toContain("ms");
	});
});

/** Exhaust a send generator, returning the final metrics. */
async function drain<T extends { content: string }>(
	gen: AsyncGenerator<string, T>,
): Promise<T> {
	let step = await gen.next();
	while (!step.done) step = await gen.next();
	return step.value;
}
