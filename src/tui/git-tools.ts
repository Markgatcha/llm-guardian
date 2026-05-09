async function runGit(args: string[]): Promise<string> {
	const proc = Bun.spawn(["git", ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (exitCode !== 0) {
		throw new Error(stderr.trim() || `git ${args.join(" ")} failed`);
	}
	return stdout.trim();
}

export async function gitDiff(): Promise<string> {
	const diff = await runGit(["diff", "--", "."]);
	return diff || "No git diff.";
}

export async function gitStatusShort(): Promise<string> {
	const status = await runGit(["status", "--short"]);
	return status || "Working tree clean.";
}

export interface PatchSnapshot {
	id: string;
	label: string;
	diff: string;
	createdAt: string;
}

export class PatchHistory {
	private undoStack: PatchSnapshot[] = [];
	private redoStack: PatchSnapshot[] = [];

	push(label: string, diff: string): void {
		if (!diff.trim()) return;
		this.undoStack.push({
			id: `patch-${Date.now().toString(36)}`,
			label,
			diff,
			createdAt: new Date().toISOString(),
		});
		this.redoStack = [];
	}

	undo(): string {
		const snapshot = this.undoStack.pop();
		if (!snapshot) return "No assistant patch snapshot to undo.";
		this.redoStack.push(snapshot);
		return "Undo is staged in history, but automatic patch reversal is disabled until ownership checks are implemented.";
	}

	redo(): string {
		const snapshot = this.redoStack.pop();
		if (!snapshot) return "No assistant patch snapshot to redo.";
		this.undoStack.push(snapshot);
		return "Redo is staged in history, but automatic patch reapply is disabled until ownership checks are implemented.";
	}
}
