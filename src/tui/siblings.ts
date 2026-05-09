import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { GuardianConfig, SiblingStatus } from "./types.ts";

function readPackage(path: string): { name: string; version: string } {
	try {
		const raw = JSON.parse(readFileSync(join(path, "package.json"), "utf8")) as {
			name?: unknown;
			version?: unknown;
		};
		return {
			name: typeof raw.name === "string" ? raw.name : "package.json missing name",
			version: typeof raw.version === "string" ? raw.version : "unknown",
		};
	} catch {
		return { name: "package.json unavailable", version: "unknown" };
	}
}

function statusFor(
	id: SiblingStatus["id"],
	label: string,
	projectRoot: string,
	configuredPath: string,
): SiblingStatus {
	const configured = resolve(projectRoot, configuredPath);
	const path = existsSync(configured)
		? configured
		: findSiblingPath(projectRoot, id) ?? configured;
	const exists = existsSync(path);
	const hasGit = existsSync(join(path, ".git"));
	const pkg = exists ? readPackage(path) : { name: "not found", version: "unknown" };
	return {
		id,
		label,
		path,
		exists,
		hasGit,
		packageName: pkg.name,
		version: pkg.version,
		note: exists
			? "discovered read-only"
			: "not found; set an override in .guardian/config.json",
	};
}

function findSiblingPath(projectRoot: string, directoryName: string): string | null {
	let current = resolve(projectRoot);
	for (let i = 0; i < 4; i++) {
		const candidate = join(current, directoryName);
		if (existsSync(candidate)) {
			return candidate;
		}
		const parentCandidate = join(dirname(current), directoryName);
		if (existsSync(parentCandidate)) {
			return parentCandidate;
		}
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return null;
}

export function discoverSiblings(
	projectRoot: string,
	config: GuardianConfig,
): SiblingStatus[] {
	return [
		statusFor("memos", "MemOS", projectRoot, config.siblings.memos),
		statusFor(
			"universal-mcp-toolkit",
			"Universal MCP Toolkit",
			projectRoot,
			config.siblings.universalMcpToolkit,
		),
	];
}
