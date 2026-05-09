import { expect, test } from "bun:test";
import {
	filterCommands,
	findCommand,
} from "../../src/tui/commands.ts";
import {
	createSlashState,
	detectComposerMode,
	reduceSlashState,
	shouldOpenSlash,
} from "../../src/tui/slash-controller.ts";

test("slash filtering returns visible commands for empty slash", () => {
	const matches = filterCommands("/");
	expect(matches.length).toBeGreaterThan(10);
	expect(matches.some((match) => match.command.name === "/status")).toBe(true);
});

test("slash filtering ranks direct status matches before fuzzy settings", () => {
	const names = filterCommands("/st").map((match) => match.command.name);
	expect(names[0]).toBe("/status");
	expect(names).toContain("/settings");
	expect(names.indexOf("/status")).toBeLessThan(names.indexOf("/settings"));
});

test("command aliases and disabled metadata are exposed", () => {
	expect(findCommand("/providers")?.id).toBe("models");
	expect(findCommand("/settings")?.enabled).toBe(false);
	expect(findCommand("/settings")?.disabledReason).toContain("planned");
});

test("slash mode only opens for command-position slash", () => {
	expect(detectComposerMode("/status")).toBe("slash");
	expect(detectComposerMode("@src/tui/index.ts")).toBe("file");
	expect(detectComposerMode("!git status")).toBe("shell");
	expect(detectComposerMode("fix src/foo/bar.ts")).toBe("normal");
	expect(shouldOpenSlash("  /st")).toBe(true);
	expect(shouldOpenSlash("fix src/foo/bar.ts")).toBe(false);
});

test("slash navigation moves highlight and scrolls", () => {
	let state = createSlashState("/", undefined, 4);
	expect(state.highlightedIndex).toBe(0);
	state = reduceSlashState(state, "down").state;
	expect(state.highlightedIndex).toBe(1);
	state = reduceSlashState(state, "up").state;
	expect(state.highlightedIndex).toBe(0);
	state = reduceSlashState(state, "page-down").state;
	expect(state.highlightedIndex).toBe(4);
	expect(state.scrollOffset).toBeGreaterThan(0);
	state = reduceSlashState(state, "page-up").state;
	expect(state.highlightedIndex).toBe(0);
});

test("tab completes selected command", () => {
	const state = createSlashState("/st");
	const result = reduceSlashState(state, "complete");
	expect(result.insertText).toBe("/status");
	expect(result.close).toBe(true);
});

test("enter runs no-argument command and inserts argument command text", () => {
	const status = reduceSlashState(createSlashState("/status"), "enter");
	expect(status.runCommand?.name).toBe("/status");
	expect(status.runText).toBe("/status");

	const fleet = reduceSlashState(createSlashState("/fleet"), "enter");
	expect(fleet.insertText).toBe("/fleet ");
	expect(fleet.runCommand).toBeUndefined();

	const fleetWithArgs = reduceSlashState(
		createSlashState("/fleet --dry-run fix tests"),
		"enter",
	);
	expect(fleetWithArgs.runCommand?.name).toBe("/fleet");
	expect(fleetWithArgs.runText).toBe("/fleet --dry-run fix tests");
});

test("escape and backspace close slash mode", () => {
	const escaped = reduceSlashState(createSlashState("/status"), "escape");
	expect(escaped.close).toBe(true);
	expect(escaped.state.open).toBe(false);

	const backspaced = reduceSlashState(createSlashState("/"), "backspace");
	expect(backspaced.close).toBe(true);
	expect(backspaced.insertText).toBe("");
	expect(backspaced.state.open).toBe(false);
});
