import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export interface FileCandidate {
	path: string;
	size: number;
}

export interface AttachedFile {
	path: string;
	size: number;
	content: string;
	truncated: boolean;
}

export interface FilePickerState {
	open: boolean;
	query: string;
	matches: FileCandidate[];
	highlightedIndex: number;
	scrollOffset: number;
	pageSize: number;
}

const ignoredDirs = new Set([
	".git",
	"node_modules",
	"dist",
	"build",
	".guardian/cache",
	".guardian/fleet",
	"coverage",
]);

const ignoredExtensions = new Set([
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".ico",
	".pdf",
	".zip",
	".gz",
	".lock",
]);

export function scanProjectFiles(projectRoot: string, limit = 2500): FileCandidate[] {
	const root = resolve(projectRoot);
	const results: FileCandidate[] = [];
	const walk = (dir: string) => {
		if (results.length >= limit) return;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (results.length >= limit) break;
			const absolute = join(dir, entry.name);
			const rel = relative(root, absolute).replace(/\\/g, "/");
			if ([...ignoredDirs].some((ignored) => rel === ignored || rel.startsWith(`${ignored}/`))) {
				continue;
			}
			if (entry.isDirectory()) {
				walk(absolute);
				continue;
			}
			if (!entry.isFile()) continue;
			const extension = entry.name.includes(".")
				? `.${entry.name.split(".").pop() ?? ""}`.toLowerCase()
				: "";
			if (ignoredExtensions.has(extension)) continue;
			const stat = statSync(absolute);
			if (stat.size > 512_000) continue;
			results.push({ path: rel, size: stat.size });
		}
	};
	if (existsSync(root)) walk(root);
	return results.sort((a, b) => a.path.localeCompare(b.path));
}

function fuzzyScore(query: string, path: string): number {
	const q = query.toLowerCase();
	const p = path.toLowerCase();
	if (!q) return 1;
	if (p.startsWith(q)) return 10_000 - p.length;
	if (p.includes(q)) return 8000 - p.indexOf(q);
	let cursor = 0;
	let score = 0;
	for (const char of q) {
		const index = p.indexOf(char, cursor);
		if (index === -1) return 0;
		score += index === cursor ? 4 : 1;
		cursor = index + 1;
	}
	return score;
}

export function shouldOpenFilePicker(value: string): boolean {
	const trimmed = value.trimStart();
	return trimmed.startsWith("@") && !trimmed.includes(" ");
}

export function filterFiles(files: FileCandidate[], query: string): FileCandidate[] {
	const bare = query.trim().replace(/^@/, "");
	return files
		.map((file) => ({ file, score: fuzzyScore(bare, file.path) }))
		.filter((item) => item.score > 0)
		.sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path))
		.map((item) => item.file);
}

export function createFilePickerState(
	value: string,
	files: FileCandidate[],
	previous?: FilePickerState,
	pageSize = 8,
): FilePickerState {
	const query = value.trimStart();
	const matches = filterFiles(files, query).slice(0, 200);
	const highlightedIndex = Math.max(
		0,
		Math.min(previous?.highlightedIndex ?? 0, Math.max(0, matches.length - 1)),
	);
	return {
		open: shouldOpenFilePicker(value),
		query,
		matches,
		highlightedIndex,
		scrollOffset: Math.min(previous?.scrollOffset ?? 0, Math.max(0, matches.length - pageSize)),
		pageSize,
	};
}

export function moveFileHighlight(state: FilePickerState, delta: number): FilePickerState {
	if (state.matches.length === 0) return state;
	const highlightedIndex = Math.max(
		0,
		Math.min(state.matches.length - 1, state.highlightedIndex + delta),
	);
	const scrollOffset =
		highlightedIndex < state.scrollOffset
			? highlightedIndex
			: highlightedIndex >= state.scrollOffset + state.pageSize
				? highlightedIndex - state.pageSize + 1
				: state.scrollOffset;
	return { ...state, highlightedIndex, scrollOffset };
}

export function selectedFile(state: FilePickerState): FileCandidate | undefined {
	return state.matches[state.highlightedIndex];
}

export function attachFile(projectRoot: string, candidate: FileCandidate): AttachedFile {
	const absolute = resolve(projectRoot, candidate.path);
	const raw = readFileSync(absolute, "utf8");
	const maxChars = 24_000;
	return {
		path: candidate.path,
		size: candidate.size,
		content: raw.length > maxChars ? raw.slice(0, maxChars) : raw,
		truncated: raw.length > maxChars,
	};
}

export function renderAttachedFiles(files: AttachedFile[]): string {
	if (files.length === 0) return "";
	return files.map((file) => `@${file.path}`).join("  ");
}

export function attachedFilesContext(files: AttachedFile[]): string {
	if (files.length === 0) return "";
	return [
		"Attached files:",
		...files.map((file) =>
			[
				`File: ${file.path}`,
				`Size: ${file.size} bytes${file.truncated ? " (truncated)" : ""}`,
				"```",
				file.content,
				"```",
			].join("\n"),
		),
	].join("\n\n");
}
