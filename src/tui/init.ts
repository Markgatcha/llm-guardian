import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function readJson(path: string): Record<string, unknown> {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	} catch {
		return {};
	}
}

function listTopLevel(projectRoot: string): string[] {
	return readdirSync(projectRoot, { withFileTypes: true })
		.filter((entry) => !entry.name.startsWith(".") || entry.name === ".guardian")
		.slice(0, 40)
		.map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`);
}

export function initGuardianNotes(projectRoot: string): string {
	const packageJson = readJson(join(projectRoot, "package.json"));
	const scripts =
		typeof packageJson.scripts === "object" && packageJson.scripts !== null
			? Object.keys(packageJson.scripts as Record<string, unknown>)
			: [];
	const notesPath = join(projectRoot, ".guardian", "GUARDIAN.md");
	const previous = existsSync(notesPath) ? readFileSync(notesPath, "utf8") : "";
	const content = [
		"# Guardian",
		"",
		"## Project Overview",
		`${String(packageJson.name ?? "llm-guardian")} is the Guardian CLI and routing console for cost-aware model work, Semantic Folding, VCM Sharding, budgets, MCP context, and safe fleet orchestration.`,
		"",
		"## Commands",
		scripts.length > 0
			? scripts.map((script) => `- npm/bun script: ${script}`).join("\n")
			: "- No package scripts discovered.",
		"",
		"## Test and Build",
		"- Typecheck: bun run typecheck",
		"- Lint: bun run lint",
		"- TUI tests: bun test tests/tui",
		"",
		"## Repo Structure",
		...listTopLevel(projectRoot).map((entry) => `- ${entry}`),
		"",
		"## Safety Rules",
		"- Ask before shell commands that can modify files.",
		"- Do not silently overwrite user work.",
		"- Keep fleet execution read-only unless isolation and merge controls are active.",
		"- Keep provider keys out of committed files.",
		"",
		"## Guardian Notes",
		"- Prefer cheaper routed models when quality is acceptable.",
		"- Show savings from cache, Semantic Folding, and VCM Sharding.",
		"- Fleet is orchestration-first; do not claim large worker fan-out until execution is real.",
		previous.includes("## User Notes") ? previous.slice(previous.indexOf("## User Notes")) : "## User Notes\n\n",
	].join("\n");
	writeFileSync(notesPath, `${content.trim()}\n`, "utf8");
	return notesPath;
}
