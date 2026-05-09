export type CommandCategory =
	| "Session"
	| "Model"
	| "Agent"
	| "Cost"
	| "Context"
	| "Tools"
	| "Fleet"
	| "View"
	| "System";

export type CommandDangerLevel = "none" | "low" | "medium" | "high";
export type CommandMode = "immediate" | "dialog" | "panel" | "prompt";
export type CommandRunId =
	| "help"
	| "status"
	| "models"
	| "agents"
	| "fleet"
	| "sessions"
	| "new"
	| "compact"
	| "clear"
	| "files"
	| "shell"
	| "mcp"
	| "theme"
	| "settings"
	| "permissions"
	| "diff"
	| "logs"
	| "budget"
	| "cache"
	| "vcm"
	| "folding"
	| "doctor"
	| "quit"
	| "fork"
	| "connect"
	| "init"
	| "undo"
	| "redo"
	| "review"
	| (string & {});

export interface CommandDefinition {
	id: CommandRunId;
	name: string;
	aliases: string[];
	title: string;
	description: string;
	category: CommandCategory;
	argumentHint?: string;
	keywords: string[];
	enabled: boolean;
	visible: boolean;
	queueWhileBusy: boolean;
	dangerLevel: CommandDangerLevel;
	run: CommandRunId;
	insertText?: string;
	mode: CommandMode;
	requiresConfirmation: boolean;
	availableWhen?: string;
	disabledReason?: string;
	keybind?: string;
}

export interface CustomCommandSource {
	scope: "project" | "user";
	glob: ".guardian/commands/*.md" | "~/.guardian/commands/*.md";
}

export interface CustomCommandFrontmatter {
	description?: string;
	argumentHint?: string;
	category?: CommandCategory;
	model?: string;
	agent?: string;
	sandbox?: string;
	allowedTools?: string[];
	disableModelInvocation?: boolean;
	userInvocable?: boolean;
	context?: "inline" | "fork";
}

export const customCommandSources: CustomCommandSource[] = [
	{ scope: "project", glob: ".guardian/commands/*.md" },
	{ scope: "user", glob: "~/.guardian/commands/*.md" },
];

let loadedCustomCommands: CommandDefinition[] = [];

export function setCustomCommands(commands: CommandDefinition[]): void {
	loadedCustomCommands = commands;
}

type CommandInput = Omit<
	CommandDefinition,
	"aliases" | "keywords" | "enabled" | "visible" | "queueWhileBusy" | "dangerLevel" | "run" | "mode" | "requiresConfirmation"
> &
	Partial<
		Pick<
			CommandDefinition,
			| "aliases"
			| "keywords"
			| "enabled"
			| "visible"
			| "queueWhileBusy"
			| "dangerLevel"
			| "run"
			| "mode"
			| "requiresConfirmation"
		>
	>;

function command(input: CommandInput): CommandDefinition {
	return {
		aliases: [],
		keywords: [],
		enabled: true,
		visible: true,
		queueWhileBusy: true,
		dangerLevel: "none",
		run: input.id,
		mode: "immediate",
		requiresConfirmation: false,
		...input,
	};
}

export const builtInCommandRegistry: CommandDefinition[] = [
	command({
		id: "help",
		name: "/help",
		aliases: ["/?"],
		title: "Help",
		category: "System",
		description: "Open command and keybind reference.",
		keywords: ["commands", "shortcuts", "reference"],
		mode: "dialog",
	}),
	command({
		id: "status",
		name: "/status",
		title: "Status",
		category: "System",
		description: "Show runtime, model, context, MCP, budget, cache, folding, and VCM state.",
		keywords: ["doctor", "health", "runtime", "mcp", "budget"],
		mode: "dialog",
	}),
	command({
		id: "models",
		name: "/models",
		aliases: ["/providers"],
		title: "Models",
		category: "Model",
		description: "Open model and provider catalog.",
		keywords: ["provider", "openrouter", "openai", "claude", "gemini"],
		mode: "panel",
	}),
	command({
		id: "agents",
		name: "/agents",
		aliases: ["/agent"],
		title: "Agents",
		category: "Agent",
		description: "Switch Guardian mode between build, plan, and audit.",
		argumentHint: "[build|plan|audit]",
		keywords: ["mode", "build", "plan", "audit"],
		keybind: "tab",
	}),
	command({
		id: "fleet",
		name: "/fleet",
		title: "Fleet",
		category: "Fleet",
		description: "Plan parallel subagents for complex work with budget controls.",
		argumentHint: "[--dry-run|--run --execute-readonly] [--max n] [task]",
		keywords: ["subagents", "parallel", "swarm", "workers", "task graph"],
		mode: "panel",
	}),
	command({
		id: "sessions",
		name: "/sessions",
		aliases: ["/resume", "/continue", "/fork"],
		title: "Sessions",
		category: "Session",
		description: "List and resume saved sessions.",
		keywords: ["history", "resume", "continue"],
		mode: "panel",
	}),
	command({
		id: "new",
		name: "/new",
		title: "New Session",
		category: "Session",
		description: "Start a fresh local chat session.",
		keywords: ["reset", "fresh"],
		keybind: "ctrl+l",
	}),
	command({
		id: "compact",
		name: "/compact",
		aliases: ["/fold"],
		title: "Compact Context",
		category: "Context",
		description: "Compact text or current context with Semantic Folding.",
		argumentHint: "[text]",
		keywords: ["summarize", "fold", "context"],
	}),
	command({
		id: "clear",
		name: "/clear",
		aliases: ["/reset"],
		title: "Clear Transcript",
		category: "Session",
		description: "Clear the visible transcript and return to the home state.",
		keywords: ["new", "reset"],
	}),
	command({
		id: "files",
		name: "/files",
		title: "Files",
		category: "Context",
		description: "Open file picker for context attachments.",
		keywords: ["context", "attach", "search"],
		mode: "panel",
	}),
	command({
		id: "shell",
		name: "/shell",
		title: "Shell Mode",
		category: "Tools",
		description: "Toggle shell mode for commands, same grammar as !.",
		keywords: ["terminal", "bash", "powershell"],
	}),
	command({
		id: "connect",
		name: "/connect",
		title: "Connect",
		category: "Model",
		description: "Open provider setup guidance for API keys.",
		keywords: ["api", "key", "provider", "setup"],
		mode: "dialog",
	}),
	command({
		id: "mcp",
		name: "/mcp",
		title: "MCP",
		category: "Context",
		description: "Open MCP manager and sibling readiness.",
		keywords: ["tools", "siblings", "memos", "toolkit"],
		mode: "panel",
		enabled: false,
		disabledReason: "MCP manager is planned; /siblings is available now.",
	}),
	command({
		id: "theme",
		name: "/theme",
		aliases: ["/themes"],
		title: "Theme",
		category: "View",
		description: "Open theme selector.",
		keywords: ["appearance", "colors"],
		enabled: false,
		disabledReason: "Theme switching is planned.",
	}),
	command({
		id: "settings",
		name: "/settings",
		title: "Settings",
		category: "System",
		description: "Open Guardian settings.",
		keywords: ["config", "preferences"],
		enabled: false,
		disabledReason: "Settings UI is planned.",
	}),
	command({
		id: "permissions",
		name: "/permissions",
		title: "Permissions",
		category: "Tools",
		description: "Open approval and sandbox policy settings.",
		keywords: ["sandbox", "approvals", "tools"],
		mode: "dialog",
	}),
	command({
		id: "diff",
		name: "/diff",
		title: "Diff",
		category: "Tools",
		description: "Show current git diff.",
		keywords: ["git", "changes", "review"],
		mode: "dialog",
	}),
	command({
		id: "undo",
		name: "/undo",
		title: "Undo",
		category: "Tools",
		description: "Undo last assistant patch snapshot when safe.",
		keywords: ["patch", "revert"],
		mode: "dialog",
	}),
	command({
		id: "redo",
		name: "/redo",
		title: "Redo",
		category: "Tools",
		description: "Restore last undone assistant patch snapshot when safe.",
		keywords: ["patch", "restore"],
		mode: "dialog",
	}),
	command({
		id: "review",
		name: "/review",
		title: "Review",
		category: "Tools",
		description: "Ask the Audit agent to review the current git diff.",
		keywords: ["audit", "diff", "security"],
		mode: "prompt",
	}),
	command({
		id: "logs",
		name: "/logs",
		aliases: ["/requests"],
		title: "Logs",
		category: "View",
		description: "Open request logs and debug console.",
		keywords: ["requests", "debug", "console"],
		mode: "panel",
	}),
	command({
		id: "budget",
		name: "/budget",
		aliases: ["/budgets", "/cost", "/costs"],
		title: "Budget",
		category: "Cost",
		description: "Show cost, token, and tool-call budget.",
		keywords: ["spend", "tokens", "cost"],
		mode: "panel",
	}),
	command({
		id: "cache",
		name: "/cache",
		title: "Cache",
		category: "Cost",
		description: "Show prompt and context cache status.",
		keywords: ["hits", "context", "savings"],
		enabled: false,
		disabledReason: "Cache panel is planned; savings view is available.",
	}),
	command({
		id: "vcm",
		name: "/vcm",
		title: "VCM",
		category: "Cost",
		description: "Toggle or configure VCM Sharding.",
		keywords: ["sharding", "compression", "context"],
		enabled: false,
		disabledReason: "VCM configuration UI is planned; telemetry is visible in /budget.",
	}),
	command({
		id: "folding",
		name: "/folding",
		title: "Folding",
		category: "Cost",
		description: "Toggle or configure Semantic Folding.",
		keywords: ["semantic", "compact", "compression"],
		enabled: false,
		disabledReason: "Folding configuration UI is planned; /compact works now.",
	}),
	command({
		id: "doctor",
		name: "/doctor",
		title: "Doctor",
		category: "System",
		description: "Run health checks.",
		keywords: ["status", "health", "diagnostics"],
		mode: "dialog",
	}),
	command({
		id: "init",
		name: "/init",
		title: "Init",
		category: "System",
		description: "Scan the repo and create or update .guardian/GUARDIAN.md.",
		keywords: ["setup", "notes", "repo"],
		mode: "dialog",
	}),
	command({
		id: "quit",
		name: "/quit",
		aliases: ["/exit", "/q"],
		title: "Quit",
		category: "System",
		description: "Exit Guardian.",
		keywords: ["close", "leave"],
		dangerLevel: "low",
	}),
];

export function commandRegistry(): CommandDefinition[] {
	return [...builtInCommandRegistry, ...loadedCustomCommands];
}

export function findCommand(input: string): CommandDefinition | undefined {
	const normalized = input.startsWith("/") ? input : `/${input}`;
	return commandRegistry().find(
		(command) =>
			command.name === normalized || command.aliases.includes(normalized),
	);
}

export function commandNames(): string[] {
	return commandRegistry().flatMap((command) => [
		command.name,
		...command.aliases,
	]);
}

export function commandDisplayName(command: CommandDefinition): string {
	return `${command.name}${command.argumentHint ? ` ${command.argumentHint}` : ""}`;
}

function fuzzyScore(needle: string, haystack: string): number {
	if (!needle) return 0;
	let cursor = 0;
	let score = 0;
	for (const char of needle) {
		const index = haystack.indexOf(char, cursor);
		if (index === -1) return 0;
		score += index === cursor ? 3 : 1;
		cursor = index + 1;
	}
	return score;
}

export interface CommandMatch {
	command: CommandDefinition;
	score: number;
	reason: "command" | "alias" | "title" | "keyword" | "fuzzy" | "all";
}

export function filterCommands(query: string): CommandMatch[] {
	const normalized = query.trim().toLowerCase();
	const bare = normalized.replace(/^\//, "").split(/\s+/, 1)[0] ?? "";
	return commandRegistry()
		.filter((command) => command.visible)
		.map((command, index): CommandMatch | null => {
			if (!bare) {
				return { command, score: 10_000 - index, reason: "all" };
			}
			const name = command.name.slice(1).toLowerCase();
			if (name.startsWith(bare)) {
				return { command, score: 9000 - index, reason: "command" };
			}
			if (command.aliases.some((alias) => alias.slice(1).toLowerCase().startsWith(bare))) {
				return { command, score: 8000 - index, reason: "alias" };
			}
			if (command.title.toLowerCase().startsWith(bare)) {
				return { command, score: 7000 - index, reason: "title" };
			}
			if (command.keywords.some((keyword) => keyword.toLowerCase().includes(bare))) {
				return { command, score: 6000 - index, reason: "keyword" };
			}
			const fuzzy = Math.max(
				fuzzyScore(bare, name),
				fuzzyScore(bare, command.title.toLowerCase()),
			);
			if (fuzzy > 0) {
				return { command, score: 1000 + fuzzy - index, reason: "fuzzy" };
			}
			return null;
		})
		.filter((match): match is CommandMatch => match !== null)
		.sort((a, b) => b.score - a.score);
}

export function commandPaletteText(query = "/"): string {
	const rows = filterCommands(query).slice(0, 12);
	return rows
		.map(({ command }) => {
			const state = command.enabled ? "ready" : "planned";
			const keybind = command.keybind ? ` ${command.keybind}` : "";
			return `${commandDisplayName(command).padEnd(22)} ${command.category.padEnd(8)} ${state.padEnd(7)}${keybind.padEnd(9)} ${command.description}`;
		})
		.join("\n");
}

export function helpText(): string {
	const categories = Array.from(
		new Set(commandRegistry().map((command) => command.category)),
	);
	return categories
		.flatMap((category) => [
			category,
			...commandRegistry()
				.filter((command) => command.category === category)
				.map((command) => {
					const aliases =
						command.aliases.length > 0 ? ` (${command.aliases.join(", ")})` : "";
					const keybind = command.keybind ? ` [${command.keybind}]` : "";
					const state = command.enabled ? "" : " [planned]";
					return `  ${commandDisplayName(command)}${aliases}${keybind}${state} - ${command.description}`;
				}),
			"",
		])
		.join("\n");
}
