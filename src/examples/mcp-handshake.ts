// MCP Handshake — Integration with Universal-MCP-Toolkit
// Demonstrates Tool Fusion intercepting and compressing MCP tool outputs

import { estimateTokens } from "../core/folding-engine.ts";
import { fuseToolMessages, fuseToolOutputs } from "../core/tool-fuser.ts";
import type { ChatMessage, ToolOutput } from "../core/types.ts";

// ─── Simulated MCP Tool Outputs ──────────────────────────────────────────────

const MCP_OUTPUTS: ToolOutput[] = [
	{
		toolName: "filesystem.read",
		result: {
			path: "/src/core/orchestrator.ts",
			content:
				"import { Hono } from 'hono';\nimport { orchestrate } from './orchestrator.ts';\n// ... 200 lines of code",
			size: 8_432,
			lastModified: "2026-04-01T10:30:00Z",
		},
		latencyMs: 12,
		tokens: 250,
	},
	{
		toolName: "filesystem.read",
		result: {
			path: "/src/core/folding-engine.ts",
			content: "export function foldText(text: string) { /* ... */ }",
			size: 5_200,
			lastModified: "2026-04-01T09:15:00Z",
		},
		latencyMs: 8,
		tokens: 180,
	},
	{
		toolName: "shell.exec",
		result: {
			stdout: "Tests passed: 47/47\nCoverage: 94.2%\nLint: 0 warnings",
			stderr: "",
			exitCode: 0,
			duration: "2.3s",
		},
		latencyMs: 2_340,
		tokens: 45,
	},
	{
		toolName: "web.search",
		result: [
			{
				title: "Bun 1.2 Release Notes",
				url: "https://bun.sh/blog/bun-v1.2",
				snippet: "Bun 1.2 introduces native TypeScript execution...",
			},
			{
				title: "Hono Framework Guide",
				url: "https://hono.dev/guides",
				snippet: "Hono is a lightweight, ultrafast web framework...",
			},
			{
				title: "OpenRouter API Docs",
				url: "https://openrouter.ai/docs",
				snippet: "Access 200+ models through a single API...",
			},
			{
				title: "Semantic Folding Paper",
				url: "https://arxiv.org/example",
				snippet: "Entity-dense headlinese compression for LLMs...",
			},
		],
		latencyMs: 450,
		tokens: 320,
	},
	{
		toolName: "database.query",
		result: {
			rows: [
				{ id: 1, model: "gpt-4o-mini", requests: 1542, cost: 12.34 },
				{ id: 2, model: "claude-4-haiku", requests: 876, cost: 8.91 },
				{ id: 3, model: "gemini-3.1-flash", requests: 2341, cost: 5.67 },
			],
			rowCount: 3,
			executionTime: "4ms",
		},
		latencyMs: 4,
		tokens: 150,
	},
	{
		toolName: "git.status",
		result: {
			branch: "main",
			ahead: 2,
			behind: 0,
			modified: ["src/core/orchestrator.ts", "src/core/types.ts"],
			staged: [],
			untracked: ["src/examples/mcp-handshake.ts"],
		},
		latencyMs: 15,
		tokens: 85,
	},
];

// ─── Demo Function ───────────────────────────────────────────────────────────

function runDemo() {
	console.log("═══════════════════════════════════════════════════");
	console.log("  LLM-Guardian V1.0.0 — MCP Handshake Demo");
	console.log("  Tool Fusion: 6 outputs → 1 semantic block");
	console.log("═══════════════════════════════════════════════════\n");

	// Show original outputs
	console.log("── Original Tool Outputs ────────────────────────");
	const originalTokens = MCP_OUTPUTS.reduce(
		(sum, o) => sum + estimateTokens(JSON.stringify(o.result)),
		0,
	);
	console.log(`Total outputs: ${MCP_OUTPUTS.length}`);
	console.log(`Total tokens:  ~${originalTokens}`);

	for (const output of MCP_OUTPUTS) {
		const tokens = estimateTokens(JSON.stringify(output.result));
		console.log(
			`  ${output.toolName}: ~${tokens} tokens, ${output.latencyMs}ms`,
		);
	}

	// Run fusion
	const fused = fuseToolOutputs(MCP_OUTPUTS);

	console.log("\n── Fused Output ─────────────────────────────────");
	console.log(fused.fusedContent);
	console.log(`\nFused tokens:   ~${estimateTokens(fused.fusedContent)}`);
	console.log(`Tokens saved:   ${fused.tokensSaved}`);
	console.log(`Fusion time:    ${fused.fusionTimeMs.toFixed(2)}ms`);

	const savingsPercent = ((fused.tokensSaved / originalTokens) * 100).toFixed(
		1,
	);
	console.log(`Reduction:      ${savingsPercent}%`);

	// Message-level fusion demo
	console.log("\n═══════════════════════════════════════════════════");
	console.log("  Message-Level Fusion Demo");
	console.log("═══════════════════════════════════════════════════\n");

	const messages: ChatMessage[] = [
		{
			role: "user",
			content:
				"Read orchestrator.ts and folding-engine.ts, then run tests and check git status",
		},
		{
			role: "assistant",
			content: "I'll gather all that information for you.",
			name: "assistant",
		},
		{
			role: "tool",
			name: "filesystem.read",
			content: JSON.stringify(MCP_OUTPUTS[0].result),
		},
		{
			role: "tool",
			name: "filesystem.read",
			content: JSON.stringify(MCP_OUTPUTS[1].result),
		},
		{
			role: "tool",
			name: "shell.exec",
			content: JSON.stringify(MCP_OUTPUTS[2].result),
		},
		{
			role: "tool",
			name: "git.status",
			content: JSON.stringify(MCP_OUTPUTS[5].result),
		},
		{
			role: "assistant",
			content: "Here's a summary of what I found...",
			name: "assistant",
		},
	];

	const originalMsgTokens = messages.reduce(
		(s, m) => s + estimateTokens(m.content),
		0,
	);

	const result = fuseToolMessages(messages);

	console.log(
		`Messages:         ${messages.length} → ${result.messages.length}`,
	);
	console.log(`Original tokens:  ~${originalMsgTokens}`);
	console.log(`Tokens saved:     ${result.tokensSaved}`);

	console.log("\n── Fused Messages ───────────────────────────────");
	for (const msg of result.messages) {
		const role = msg.role.padEnd(10);
		const preview = msg.content.slice(0, 100);
		console.log(`[${role}] ${preview}${msg.content.length > 100 ? "..." : ""}`);
	}

	console.log("\n Done. Tool fusion verified.\n");
}

runDemo();

export default runDemo;
