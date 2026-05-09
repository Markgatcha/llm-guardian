import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentId } from "./agents.ts";
import type { AttachedFile } from "./file-picker.ts";
import type { ChatTurn } from "./types.ts";

export interface GuardianSession {
	id: string;
	title: string;
	model: string;
	agent: AgentId;
	turns: ChatTurn[];
	attachedFiles: Array<Pick<AttachedFile, "path" | "size" | "truncated">>;
	createdAt: string;
	updatedAt: string;
	forkedFrom?: string;
}

function sessionsDir(projectRoot: string): string {
	return join(projectRoot, ".guardian", "sessions");
}

export function createSessionId(): string {
	return `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function sessionPath(projectRoot: string, id: string): string {
	return join(sessionsDir(projectRoot), `${id}.json`);
}

export function saveSession(projectRoot: string, session: GuardianSession): void {
	mkdirSync(sessionsDir(projectRoot), { recursive: true });
	writeFileSync(sessionPath(projectRoot, session.id), `${JSON.stringify(session, null, 2)}\n`, "utf8");
}

export function loadSession(projectRoot: string, id: string): GuardianSession | null {
	const path = sessionPath(projectRoot, id);
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf8")) as GuardianSession;
	} catch {
		return null;
	}
}

export function listSessions(projectRoot: string): GuardianSession[] {
	const dir = sessionsDir(projectRoot);
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((name) => name.endsWith(".json"))
		.map((name) => loadSession(projectRoot, name.replace(/\.json$/, "")))
		.filter((session): session is GuardianSession => session !== null)
		.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function latestSession(projectRoot: string): GuardianSession | null {
	return listSessions(projectRoot)[0] ?? null;
}

export function titleFromTurns(turns: ChatTurn[]): string {
	const first = turns.find((turn) => turn.role === "user")?.content.trim();
	if (!first) return "New Guardian session";
	return first.replace(/\s+/g, " ").slice(0, 80);
}

export function renderSessions(sessions: GuardianSession[]): string {
	if (sessions.length === 0) return "Sessions\n\nNo saved sessions yet.";
	return [
		"Sessions",
		"",
		"ID                         UPDATED                  AGENT   MODEL                TITLE",
		...sessions.slice(0, 20).map((session) =>
			[
				session.id.padEnd(26),
				new Date(session.updatedAt).toLocaleString().padEnd(24),
				session.agent.padEnd(7),
				session.model.padEnd(20),
				session.title,
			].join("  "),
		),
		"",
		"Use /resume <id>, /continue, or /fork.",
	].join("\n");
}
