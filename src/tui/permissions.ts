import type { PermissionName, PermissionState } from "./agents.ts";

export interface PermissionPolicy {
	edit: PermissionState;
	shell: PermissionState;
	read: PermissionState;
	web: PermissionState;
	mcp: PermissionState;
	fleet: PermissionState;
	git: PermissionState;
}

export interface PermissionRequest {
	id: string;
	permission: PermissionName;
	action: string;
	reason: string;
	command?: string;
	risk: "low" | "medium" | "high";
	state: PermissionState;
}

export const defaultPermissions: PermissionPolicy = {
	edit: "ask",
	shell: "ask",
	read: "allow",
	web: "ask",
	mcp: "ask",
	fleet: "ask",
	git: "ask",
};

const readOnlyShellPrefixes = [
	"dir",
	"ls",
	"pwd",
	"cd",
	"git status",
	"git diff",
	"git log",
	"git show",
	"rg",
	"grep",
	"type",
	"cat",
	"Get-ChildItem",
	"Get-Content",
	"Select-String",
];

const destructivePatterns = [
	/\brm\b/i,
	/\bdel\b/i,
	/\berase\b/i,
	/\bRemove-Item\b/i,
	/\bgit\s+reset\b/i,
	/\bgit\s+checkout\b/i,
	/\bgit\s+clean\b/i,
	/\bformat\b/i,
	/>/,
	/>>/,
];

export function classifyShellCommand(command: string): PermissionRequest {
	const trimmed = command.trim();
	const destructive = destructivePatterns.some((pattern) => pattern.test(trimmed));
	const readOnly = readOnlyShellPrefixes.some((prefix) =>
		trimmed.toLowerCase().startsWith(prefix.toLowerCase()),
	);
	const risk = destructive ? "high" : readOnly ? "low" : "medium";
	return {
		id: `perm-${Date.now().toString(36)}`,
		permission: "shell",
		action: "Run shell command",
		reason: destructive
			? "Command may modify or delete files."
			: readOnly
				? "Command appears read-only."
				: "Command effect is unknown.",
		command: trimmed,
		risk,
		state: destructive ? "ask" : readOnly ? "allow" : "ask",
	};
}

export function canAutoAllow(request: PermissionRequest, policy = defaultPermissions): boolean {
	const configured = policy[request.permission];
	if (configured === "deny") return false;
	if (configured === "allow" && request.risk !== "high") return true;
	return request.state === "allow" && request.risk === "low";
}

export function isDenied(request: PermissionRequest, policy = defaultPermissions): boolean {
	return policy[request.permission] === "deny";
}

export function permissionPromptText(request: PermissionRequest): string {
	return [
		"Permission required",
		`Action: ${request.action}`,
		`Risk: ${request.risk}`,
		`Reason: ${request.reason}`,
		request.command ? `Command: ${request.command}` : "",
		"",
		"Press y to allow once, n to deny, esc to cancel.",
	]
		.filter(Boolean)
		.join("\n");
}
