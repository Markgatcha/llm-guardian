import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { findAgent, nextAgent, visibleAgents } from "../../src/tui/agents.ts";
import { setCustomCommands, filterCommands } from "../../src/tui/commands.ts";
import { loadProjectCommands, renderCustomCommand } from "../../src/tui/custom-commands.ts";
import {
	attachFile,
	attachedFilesContext,
	createFilePickerState,
	filterFiles,
	moveFileHighlight,
	scanProjectFiles,
	selectedFile,
} from "../../src/tui/file-picker.ts";
import { initGuardianNotes } from "../../src/tui/init.ts";
import { canAutoAllow, classifyShellCommand } from "../../src/tui/permissions.ts";
import {
	createSessionId,
	latestSession,
	listSessions,
	loadSession,
	saveSession,
} from "../../src/tui/sessions.ts";

const roots: string[] = [];

afterEach(() => {
	setCustomCommands([]);
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

function tempRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "guardian-interaction-"));
	roots.push(root);
	mkdirSync(join(root, ".guardian"), { recursive: true });
	return root;
}

test("file picker scans, filters, navigates, and attaches one file", () => {
	const root = tempRoot();
	mkdirSync(join(root, "src"), { recursive: true });
	writeFileSync(join(root, "src", "router.ts"), "export const router = true;\n");
	writeFileSync(join(root, "README.md"), "# Guardian\n");

	const files = scanProjectFiles(root);
	expect(files.some((file) => file.path === "src/router.ts")).toBe(true);
	expect(filterFiles(files, "@router")[0].path).toBe("src/router.ts");

	let state = createFilePickerState("@", files, undefined, 2);
	state = moveFileHighlight(state, 1);
	expect(selectedFile(state)).toBeTruthy();

	const attached = attachFile(root, { path: "src/router.ts", size: 28 });
	expect(attached.content).toContain("router");
	expect(attachedFilesContext([attached])).toContain("File: src/router.ts");
});

test("permissions classify read-only and destructive shell commands", () => {
	const readOnly = classifyShellCommand("git status --short");
	expect(readOnly.risk).toBe("low");
	expect(canAutoAllow(readOnly)).toBe(true);

	const destructive = classifyShellCommand("Remove-Item src/app.ts");
	expect(destructive.risk).toBe("high");
	expect(canAutoAllow(destructive)).toBe(false);
});

test("sessions save, list, load, and find latest", () => {
	const root = tempRoot();
	const id = createSessionId();
	saveSession(root, {
		id,
		title: "Test session",
		model: "auto",
		agent: "build",
		turns: [{ id: "u1", role: "user", content: "hello", status: "done" }],
		attachedFiles: [],
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:01.000Z",
	});

	expect(loadSession(root, id)?.title).toBe("Test session");
	expect(listSessions(root)).toHaveLength(1);
	expect(latestSession(root)?.id).toBe(id);
});

test("agent registry cycles primary agents and resolves manual mentions", () => {
	const build = findAgent("@build");
	expect(build?.title).toBe("Build");
	expect(nextAgent(build ?? visibleAgents()[0]).id).toBe("plan");
	expect(findAgent("audit")?.permissions.edit).toBe("deny");
});

test("project custom commands load into slash filtering", () => {
	const root = tempRoot();
	const commandsDir = join(root, ".guardian", "commands");
	mkdirSync(commandsDir, { recursive: true });
	writeFileSync(
		join(commandsDir, "explain.md"),
		[
			"---",
			"description: Explain selected code",
			"argument-hint: [topic]",
			"category: Tools",
			"---",
			"Explain {{args}} with Guardian context.",
		].join("\n"),
	);

	const loaded = loadProjectCommands(root);
	expect(loaded[0].definition.name).toBe("/explain");
	expect(renderCustomCommand(loaded[0].promptTemplate, "routing")).toContain("routing");
	setCustomCommands(loaded.map((item) => item.definition));
	expect(filterCommands("/exp")[0].command.name).toBe("/explain");
});

test("init creates Guardian project notes", () => {
	const root = tempRoot();
	writeFileSync(
		join(root, "package.json"),
		JSON.stringify({ name: "llm-guardian", scripts: { test: "bun test" } }),
	);
	const path = initGuardianNotes(root);
	expect(existsSync(path)).toBe(true);
	expect(readFileSync(path, "utf8")).toContain("Semantic Folding");
});
