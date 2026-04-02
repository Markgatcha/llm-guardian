// Tool Fusion Engine — MCP Integration Block
// Intercepts multiple tool-turn outputs and fuses them into
// a single high-density semantic block, reducing token overhead

import { estimateTokens } from "./folding-engine.ts";
import type { ChatMessage, FusedToolBlock, ToolOutput } from "./types.ts";

// ─── Tool Output Compression ─────────────────────────────────────────────────

function compressToolOutput(output: ToolOutput): string {
	const { toolName, result } = output;

	if (typeof result === "string") {
		return compressStringResult(toolName, result);
	}

	if (Array.isArray(result)) {
		return compressArrayResult(toolName, result);
	}

	if (typeof result === "object" && result !== null) {
		return compressObjectResult(toolName, result as Record<string, unknown>);
	}

	return `[${toolName}]: ${String(result)}`;
}

function compressStringResult(toolName: string, result: string): string {
	// If it's JSON, try to parse and compress
	try {
		const parsed = JSON.parse(result);
		return compressObjectResult(toolName, parsed);
	} catch {
		// Not JSON — compress as text
		const trimmed = result.replace(/\s+/g, " ").trim();
		if (trimmed.length > 500) {
			// Take first 200 chars and last 100 chars
			return `[${toolName}]: ${trimmed.slice(0, 200)}...${trimmed.slice(-100)}`;
		}
		return `[${toolName}]: ${trimmed}`;
	}
}

function compressArrayResult(toolName: string, result: unknown[]): string {
	if (result.length === 0) return `[${toolName}]: empty`;

	// Summarize array
	const sample = result.slice(0, 3);
	const items = sample.map((item) => {
		if (typeof item === "string") return item.slice(0, 100);
		if (typeof item === "object" && item !== null) {
			const keys = Object.keys(item).slice(0, 3);
			return `{${keys.join(",")}}`;
		}
		return String(item);
	});

	const suffix = result.length > 3 ? `...+${result.length - 3} more` : "";
	return `[${toolName}]: [${items.join(", ")}${suffix}] (${result.length} items)`;
}

function compressObjectResult(
	toolName: string,
	result: Record<string, unknown>,
): string {
	const keys = Object.keys(result);
	if (keys.length === 0) return `[${toolName}]: {}`;

	// Pick the most important keys
	const importantKeys = keys.filter((k) => {
		const lower = k.toLowerCase();
		return (
			lower === "result" ||
			lower === "output" ||
			lower === "data" ||
			lower === "content" ||
			lower === "value" ||
			lower === "error" ||
			lower === "status" ||
			lower === "answer" ||
			lower === "text"
		);
	});

	const keysToUse = importantKeys.length > 0 ? importantKeys : keys.slice(0, 5);

	const pairs = keysToUse.map((k) => {
		const val = result[k];
		if (typeof val === "string") return `${k}: "${val.slice(0, 100)}"`;
		if (typeof val === "number" || typeof val === "boolean")
			return `${k}: ${val}`;
		if (Array.isArray(val)) return `${k}: [...${val.length} items]`;
		if (typeof val === "object") return `${k}: {...}`;
		return `${k}: ${String(val).slice(0, 50)}`;
	});

	const extra =
		keys.length > keysToUse.length
			? `, +${keys.length - keysToUse.length} keys`
			: "";
	return `[${toolName}]: {${pairs.join(", ")}${extra}}`;
}

// ─── Deduplication ───────────────────────────────────────────────────────────

function deduplicateOutputs(outputs: ToolOutput[]): ToolOutput[] {
	const seen = new Set<string>();
	const deduped: ToolOutput[] = [];

	for (const output of outputs) {
		const key = `${output.toolName}:${JSON.stringify(output.result).slice(0, 200)}`;
		if (!seen.has(key)) {
			seen.add(key);
			deduped.push(output);
		}
	}

	return deduped;
}

// ─── Semantic Grouping ───────────────────────────────────────────────────────

interface ToolGroup {
	toolName: string;
	outputs: ToolOutput[];
}

function groupByTool(outputs: ToolOutput[]): ToolGroup[] {
	const groups = new Map<string, ToolOutput[]>();

	for (const output of outputs) {
		const existing = groups.get(output.toolName) || [];
		existing.push(output);
		groups.set(output.toolName, existing);
	}

	return [...groups.entries()].map(([toolName, outputs]) => ({
		toolName,
		outputs,
	}));
}

// ─── Main Fusion Function ────────────────────────────────────────────────────

export function fuseToolOutputs(outputs: ToolOutput[]): FusedToolBlock {
	const start = performance.now();

	if (outputs.length === 0) {
		return {
			fusedContent: "",
			originalOutputs: [],
			tokensSaved: 0,
			fusionTimeMs: performance.now() - start,
		};
	}

	// Step 1: Deduplicate
	const deduped = deduplicateOutputs(outputs);

	// Step 2: Compress each output
	const _compressed = deduped.map(compressToolOutput);

	// Step 3: Group by tool and merge
	const groups = groupByTool(deduped);
	const fusedParts: string[] = [];

	for (const group of groups) {
		if (group.outputs.length === 1) {
			fusedParts.push(compressToolOutput(group.outputs[0]));
		} else {
			// Merge multiple calls to the same tool
			const results = group.outputs.map((o) => compressToolOutput(o));
			fusedParts.push(
				`[${group.toolName} x${group.outputs.length}]: ${results.join(" | ")}`,
			);
		}
	}

	const fusedContent = fusedParts.join("\n");

	// Calculate savings
	const originalTokens = outputs.reduce(
		(sum, o) => sum + estimateTokens(JSON.stringify(o.result)),
		0,
	);
	const fusedTokens = estimateTokens(fusedContent);

	return {
		fusedContent,
		originalOutputs: outputs,
		tokensSaved: Math.max(0, originalTokens - fusedTokens),
		fusionTimeMs: performance.now() - start,
	};
}

// ─── Fuse Tool Messages ──────────────────────────────────────────────────────

export function fuseToolMessages(messages: ChatMessage[]): {
	messages: ChatMessage[];
	tokensSaved: number;
} {
	const result: ChatMessage[] = [];
	let totalTokensSaved = 0;
	const pendingToolOutputs: ChatMessage[] = [];

	for (const msg of messages) {
		if (msg.role === "tool") {
			pendingToolOutputs.push(msg);
			continue;
		}

		// If we have pending tool outputs, fuse them before this non-tool message
		if (pendingToolOutputs.length > 0) {
			if (pendingToolOutputs.length === 1) {
				result.push(pendingToolOutputs[0]);
			} else {
				const outputs: ToolOutput[] = pendingToolOutputs.map((m) => ({
					toolName: m.name || "unknown",
					result: m.content,
					latencyMs: 0,
					tokens: estimateTokens(m.content),
				}));
				const fused = fuseToolOutputs(outputs);
				result.push({
					role: "tool",
					name: "fused_tools",
					content: fused.fusedContent,
				});
				totalTokensSaved += fused.tokensSaved;
			}
			pendingToolOutputs.length = 0;
		}

		result.push(msg);
	}

	// Handle trailing tool outputs
	if (pendingToolOutputs.length > 0) {
		if (pendingToolOutputs.length === 1) {
			result.push(pendingToolOutputs[0]);
		} else {
			const outputs: ToolOutput[] = pendingToolOutputs.map((m) => ({
				toolName: m.name || "unknown",
				result: m.content,
				latencyMs: 0,
				tokens: estimateTokens(m.content),
			}));
			const fused = fuseToolOutputs(outputs);
			result.push({
				role: "tool",
				name: "fused_tools",
				content: fused.fusedContent,
			});
			totalTokensSaved += fused.tokensSaved;
		}
	}

	return { messages: result, tokensSaved: totalTokensSaved };
}

export default { fuseToolOutputs, fuseToolMessages };
