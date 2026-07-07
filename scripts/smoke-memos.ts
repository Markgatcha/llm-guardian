/**
 * Smoke test: verifies the AI Trio memory integration end-to-end.
 *
 *   bun run scripts/smoke-memos.ts        # under Bun — will soft-fail (no better-sqlite3)
 *   node --experimental-strip-types scripts/smoke-memos.ts   # under Node — full pass
 *
 * Requires:
 *   - @mem-os/sdk linked into guardian's node_modules (see README "AI Trio
 *     Memory Integration"), OR memos installed.
 *   - A memos SQLite DB at ~/.memos/memos.db (or set MEMOS_STORAGE_PATH).
 *   - MEMOS_NAMESPACE set (defaults to "default").
 *
 * The test builds a real MemOS TOON context pack and confirms it survives VCM
 * sharding as the top anchor — proving guardian injects grounded memory.
 */
import os from "node:os";
import path from "node:path";

const dbPath = process.env.MEMOS_STORAGE_PATH ?? path.join(os.homedir(), ".memos", "memos.db");
process.env.MEMOS_NAMESPACE = process.env.MEMOS_NAMESPACE ?? "default";
process.env.MEMOS_STORAGE_PATH = dbPath;

async function main() {
	const { buildRequestMemoryPack } = await import("../src/core/memos-memory-source.ts");
	const { shardMessages } = await import("../src/core/vcm-sharder.ts");

	// A query we know matches the seeded demo memories ("dark mode" etc.).
	const query = process.env.SMOKE_QUERY ?? "dark mode preferences";
	console.log(`[smoke] query="${query}"  db=${dbPath}`);

	const pack = await buildRequestMemoryPack(query, 800);
	if (!pack) {
		console.error(
			"[smoke] FAIL: buildRequestMemoryPack returned null. If running under Bun, " +
			"this is expected (Bun lacks better-sqlite3) — re-run under Node. " +
			"Also confirm @mem-os/sdk is linked and the DB exists.",
		);
		process.exit(1);
	}

	const okHeader = pack.startsWith("# ai-trio.memos.context-pack.v1");
	const items = pack.split("\n").filter((l) => l.includes("|") && !l.startsWith("#"));
	console.log(`[smoke] TOON header: ${okHeader ? "OK" : "MISSING"}  items: ${items.length}`);

	const msgs = [
		{ role: "system" as const, content: `## Memory Context (from MemOS)\n${pack}` },
		{ role: "user" as const, content: query },
		{ role: "assistant" as const, content: "Noted." },
	];
	const r = shardMessages(msgs, query, { maxTokens: 3000 });
	const top = r.shardingResult.shards[0];
	const injected = top?.content.includes("ai-trio.memos.context-pack") ?? false;

	console.log(`[smoke] pack injected as top shard: ${injected ? "OK ✓" : "FAIL ✗"}`);
	if (okHeader && items.length > 0 && injected) {
		console.log("\nRESULT: real MemOS memory → Guardian TOON pack → injected shard: VERIFIED ✅");
		process.exit(0);
	}
	console.error("[smoke] FAIL: one or more checks did not pass");
	process.exit(1);
}

main();
