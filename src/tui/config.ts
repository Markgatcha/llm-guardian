import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { GuardianConfig, GuardianTuiOptions } from "./types.ts";

const DEFAULT_CONFIG: GuardianConfig = {
	apiUrl: "http://localhost:3000",
	adminKeyEnv: "GUARDIAN_API_KEY",
	refreshMs: 5000,
	theme: "guardian-dark",
	defaultModel: "auto",
	siblings: {
		memos: "../memos",
		universalMcpToolkit: "../universal-mcp-toolkit",
	},
};

function findProjectRoot(startDir = process.cwd()): string {
	let current = resolve(startDir);
	for (let i = 0; i < 10; i++) {
		if (existsSync(join(current, ".guardian")) || existsSync(join(current, ".git"))) {
			return current;
		}
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return resolve(startDir);
}

function normalizeConfig(raw: unknown): GuardianConfig {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return DEFAULT_CONFIG;
	}
	const record = raw as Record<string, unknown>;
	const siblings =
		typeof record.siblings === "object" &&
		record.siblings !== null &&
		!Array.isArray(record.siblings)
			? (record.siblings as Record<string, unknown>)
			: {};
	return {
		apiUrl: typeof record.apiUrl === "string" ? record.apiUrl : DEFAULT_CONFIG.apiUrl,
		adminKeyEnv:
			typeof record.adminKeyEnv === "string"
				? record.adminKeyEnv
				: DEFAULT_CONFIG.adminKeyEnv,
		refreshMs:
			typeof record.refreshMs === "number" && Number.isFinite(record.refreshMs)
				? Math.max(1000, record.refreshMs)
				: DEFAULT_CONFIG.refreshMs,
		theme: typeof record.theme === "string" ? record.theme : DEFAULT_CONFIG.theme,
		defaultModel:
			typeof record.defaultModel === "string"
				? record.defaultModel
				: DEFAULT_CONFIG.defaultModel,
		siblings: {
			memos:
				typeof siblings.memos === "string"
					? siblings.memos
					: DEFAULT_CONFIG.siblings.memos,
			universalMcpToolkit:
				typeof siblings.universalMcpToolkit === "string"
					? siblings.universalMcpToolkit
					: DEFAULT_CONFIG.siblings.universalMcpToolkit,
		},
	};
}

export function getProjectRoot(): string {
	return findProjectRoot();
}

export function getGuardianConfigPath(projectRoot = getProjectRoot()): string {
	return join(projectRoot, ".guardian", "config.json");
}

export function ensureGuardianConfig(projectRoot = getProjectRoot()): string {
	const guardianDir = join(projectRoot, ".guardian");
	if (!existsSync(guardianDir)) {
		mkdirSync(guardianDir, { recursive: true });
	}
	const configPath = getGuardianConfigPath(projectRoot);
	if (!existsSync(configPath)) {
		writeFileSync(configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf8");
	}
	const notesPath = join(guardianDir, "GUARDIAN.md");
	if (!existsSync(notesPath)) {
		writeFileSync(
			notesPath,
			[
				"# Guardian",
				"",
				"Project-local notes for the Guardian CLI.",
				"",
				"- Guardian is the main ops console for the AI Trio.",
				"- MemOS and Universal MCP Toolkit are discovered as sibling projects.",
				"- The terminal UI uses OpenTUI directly.",
				"",
			].join("\n"),
			"utf8",
		);
	}
	const tuiPath = join(guardianDir, "tui.jsonc");
	if (!existsSync(tuiPath)) {
		writeFileSync(
			tuiPath,
			[
				"{",
				'  "theme": "guardian-dark",',
				'  "keymap": { "commandPalette": "ctrl+p", "cycleAgent": "tab" },',
				'  "mouse": false,',
				'  "scrollSpeed": 3,',
				'  "diffStyle": "unified",',
				'  "compactMode": false,',
				'  "statusline": ["workspace", "agent", "model", "savings", "budget"]',
				"}",
				"",
			].join("\n"),
			"utf8",
		);
	}
	return configPath;
}

export function loadGuardianConfig(options: GuardianTuiOptions = {}): GuardianConfig {
	const projectRoot = getProjectRoot();
	const configPath = options.configPath
		? resolve(options.configPath)
		: ensureGuardianConfig(projectRoot);
	let config = DEFAULT_CONFIG;
	try {
		config = normalizeConfig(JSON.parse(readFileSync(configPath, "utf8")));
	} catch {
		config = DEFAULT_CONFIG;
	}
	return {
		...config,
		apiUrl: options.apiUrl ?? process.env.GUARDIAN_API_URL ?? config.apiUrl,
		refreshMs: options.refreshMs ?? config.refreshMs,
	};
}

export function resolveAdminKey(config: GuardianConfig, explicitKey?: string): string | undefined {
	return explicitKey ?? process.env[config.adminKeyEnv] ?? process.env.GUARDIAN_API_KEY;
}
