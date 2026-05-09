import {
	commandDisplayName,
	filterCommands,
	type CommandDefinition,
	type CommandMatch,
} from "./commands.ts";

export type ComposerMode = "normal" | "slash" | "file" | "shell" | "palette";
export type SlashAction =
	| "up"
	| "down"
	| "page-up"
	| "page-down"
	| "complete"
	| "enter"
	| "escape"
	| "backspace";

export interface SlashState {
	open: boolean;
	query: string;
	matches: CommandMatch[];
	highlightedIndex: number;
	scrollOffset: number;
	pageSize: number;
}

export interface SlashResult {
	state: SlashState;
	handled: boolean;
	close?: boolean;
	insertText?: string;
	runCommand?: CommandDefinition;
	runText?: string;
}

export const DEFAULT_SLASH_PAGE_SIZE = 10;

export function detectComposerMode(value: string, paletteOpen = false): ComposerMode {
	if (paletteOpen) return "palette";
	const trimmedStart = value.trimStart();
	if (trimmedStart.startsWith("/")) return "slash";
	if (trimmedStart.startsWith("@")) return "file";
	if (trimmedStart.startsWith("!")) return "shell";
	return "normal";
}

export function shouldOpenSlash(value: string): boolean {
	const leadingWhitespace = value.match(/^\s*/)?.[0] ?? "";
	const rest = value.slice(leadingWhitespace.length);
	return rest.startsWith("/") && !rest.slice(1).includes("\n");
}

export function createSlashState(
	value: string,
	previous?: SlashState,
	pageSize = DEFAULT_SLASH_PAGE_SIZE,
): SlashState {
	const query = value.trimStart();
	const matches = filterCommands(query);
	const previousCommand =
		previous?.matches[previous.highlightedIndex]?.command.name ?? "";
	const retainedIndex = matches.findIndex(
		(match) => match.command.name === previousCommand,
	);
	const highlightedIndex =
		retainedIndex >= 0 ? retainedIndex : Math.min(previous?.highlightedIndex ?? 0, matches.length - 1);
	const safeIndex = Math.max(0, highlightedIndex);
	const scrollOffset = clampScroll(
		previous?.scrollOffset ?? 0,
		safeIndex,
		matches.length,
		pageSize,
	);
	return {
		open: shouldOpenSlash(value),
		query,
		matches,
		highlightedIndex: safeIndex,
		scrollOffset,
		pageSize,
	};
}

export function visibleSlashMatches(state: SlashState): CommandMatch[] {
	return state.matches.slice(state.scrollOffset, state.scrollOffset + state.pageSize);
}

export function selectedSlashCommand(state: SlashState): CommandDefinition | undefined {
	return state.matches[state.highlightedIndex]?.command;
}

function clampScroll(
	offset: number,
	index: number,
	total: number,
	pageSize: number,
): number {
	if (total <= pageSize) return 0;
	if (index < offset) return index;
	if (index >= offset + pageSize) return index - pageSize + 1;
	return Math.min(offset, Math.max(0, total - pageSize));
}

function moveHighlight(state: SlashState, delta: number): SlashState {
	if (state.matches.length === 0) return state;
	const highlightedIndex = Math.max(
		0,
		Math.min(state.matches.length - 1, state.highlightedIndex + delta),
	);
	return {
		...state,
		highlightedIndex,
		scrollOffset: clampScroll(
			state.scrollOffset,
			highlightedIndex,
			state.matches.length,
			state.pageSize,
		),
	};
}

function completionText(command: CommandDefinition): string {
	const base = command.insertText ?? command.name;
	return command.argumentHint ? `${base} ` : base;
}

export function reduceSlashState(
	state: SlashState,
	action: SlashAction,
): SlashResult {
	switch (action) {
		case "up":
			return { state: moveHighlight(state, -1), handled: true };
		case "down":
			return { state: moveHighlight(state, 1), handled: true };
		case "page-up":
			return { state: moveHighlight(state, -state.pageSize), handled: true };
		case "page-down":
			return { state: moveHighlight(state, state.pageSize), handled: true };
		case "escape":
			return { state: { ...state, open: false }, handled: true, close: true };
		case "backspace":
			if (state.query === "/") {
				return {
					state: { ...state, open: false },
					handled: true,
					close: true,
					insertText: "",
				};
			}
			return { state, handled: false };
		case "complete": {
			const command = selectedSlashCommand(state);
			if (!command) return { state, handled: true };
			return {
				state: { ...state, open: false },
				handled: true,
				close: true,
				insertText: completionText(command),
			};
		}
		case "enter": {
			const command = selectedSlashCommand(state);
			if (!command) return { state, handled: true };
			if (command.argumentHint && state.query.trim() === command.name) {
				return {
					state,
					handled: true,
					insertText: completionText(command),
				};
			}
			return {
				state: { ...state, open: false },
				handled: true,
				close: true,
				runCommand: command,
				runText: state.query.trim(),
			};
		}
	}
}

export function renderSlashRow(match: CommandMatch, selected: boolean): string {
	const command = match.command;
	const state = command.enabled ? "" : " planned";
	const prefix = selected ? "> " : "  ";
	const display = commandDisplayName(command).padEnd(24);
	return `${prefix}${display} ${command.category.padEnd(8)}${state.padEnd(9)} ${command.description}`;
}
