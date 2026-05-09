import {
	ASCIIFont,
	Box,
	Input,
	InputRenderableEvents,
	Text,
	createCliRenderer,
	type InputRenderable,
	type Renderable,
} from "@opentui/core";
import { GuardianApiClient } from "./api-client.ts";
import {
	commandPaletteText,
	findCommand,
	helpText,
	setCustomCommands,
	type CommandDefinition,
} from "./commands.ts";
import {
	getProjectRoot,
	loadGuardianConfig,
	resolveAdminKey,
} from "./config.ts";
import { createFleetPlan, renderFleetPlan } from "./fleet.ts";
import {
	cancelFleetRun,
	createFleetRun,
	executeReadOnlyFleetRun,
	renderFleetRun,
	type FleetRun,
} from "./fleet-runner.ts";
import {
	agentHelp,
	agentRegistry,
	findAgent,
	nextAgent,
	type AgentDefinition,
} from "./agents.ts";
import { loadProjectCommands, renderCustomCommand } from "./custom-commands.ts";
import {
	attachFile,
	attachedFilesContext,
	createFilePickerState,
	moveFileHighlight,
	renderAttachedFiles,
	scanProjectFiles,
	selectedFile,
	type AttachedFile,
	type FilePickerState,
} from "./file-picker.ts";
import { clip, money, ms, numberShort, percent } from "./format.ts";
import { gitDiff, PatchHistory } from "./git-tools.ts";
import { initGuardianNotes } from "./init.ts";
import { LocalGuardianClient } from "./local-client.ts";
import {
	canAutoAllow,
	classifyShellCommand,
	defaultPermissions,
	isDenied,
	permissionPromptText,
	type PermissionRequest,
} from "./permissions.ts";
import {
	createSlashState,
	reduceSlashState,
	renderSlashRow,
	selectedSlashCommand,
	visibleSlashMatches,
	type SlashAction,
	type SlashState,
} from "./slash-controller.ts";
import {
	createSessionId,
	latestSession,
	listSessions,
	loadSession,
	renderSessions,
	saveSession,
	titleFromTurns,
	type GuardianSession,
} from "./sessions.ts";
import { discoverSiblings } from "./siblings.ts";
import { renderScreen, type ScreenId } from "./screens.ts";
import { theme } from "./theme.ts";
import type {
	ChatMessage,
	ChatTurn,
	FoldTextResult,
	GuardianSnapshot,
	GuardianTuiOptions,
	SiblingStatus,
} from "./types.ts";

type ConsoleMode = "chat" | ScreenId;
type GuardianClient = Pick<GuardianApiClient, "snapshot" | "chat" | "foldText">;
type DialogMode =
	| "palette"
	| "help"
	| "status"
	| "fleet"
	| "permission"
	| "sessions"
	| "models"
	| "connect"
	| null;

function systemPrompt(agent: AgentDefinition): ChatMessage {
	return {
		role: "system",
		content: `You are Guardian, a terminal AI assistant inside the llm-guardian CLI. ${agent.prompt} Answer clearly, prefer concrete next steps, and remember that Guardian routes requests through cost controls such as Semantic Folding, VCM Sharding, caching, and provider routing.`,
	};
}

function initialSnapshot(): GuardianSnapshot {
	return {
		connected: false,
		message: "loading",
		stats: {
			totalRequests: 0,
			totalCostUsd: 0,
			totalSavedUsd: 0,
			baselineCostUsd: 0,
			avgLatencyMs: 0,
			cacheHitRate: 0,
			avgCompressionRatio: 1,
			totalTokensOptimized: 0,
			todayRequests: 0,
			todayCostUsd: 0,
			todaySavedUsd: 0,
			monthRequests: 0,
			monthCostUsd: 0,
			monthSavedUsd: 0,
		},
		logs: [],
		providers: [],
		rules: [],
		budget: {
			dailySpentUsd: 0,
			dailyLimitUsd: 0,
			monthlySpentUsd: 0,
			monthlyLimitUsd: 0,
		},
		loadedAt: new Date(),
	};
}

function removeChildren(root: Renderable): void {
	for (const child of root.getChildren()) {
		root.remove(child.id);
	}
}

function formatTime(date: Date): string {
	return date.toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

function commandHelp(): string {
	return [
		helpText(),
		"",
		"Prompt shortcuts",
		"@path - attach a local file to the next model prompt",
		"!command - run a local shell command and add the output to chat",
		"",
		"Keys",
		"Tab - cycle agent",
		"Ctrl+P - command palette",
		"Ctrl+T - cycle agent",
		"Ctrl+R - refresh telemetry",
		"Ctrl+L - clear chat",
		"Esc - return to chat",
	].join("\n");
}

function welcomeTurn(): ChatTurn {
	return {
		id: "welcome",
		role: "assistant",
		status: "done",
		content:
			"Guardian is ready. Ask a model directly, or type /help for logs, savings, providers, budgets, rules, and sibling repo context.",
	};
}

function statusSummary(
	snapshot: GuardianSnapshot,
	siblings: SiblingStatus[],
	model: string,
	runtimeLabel: string,
): string {
	const siblingLines = siblings.map(
		(item) =>
			`${item.label}: ${item.exists ? "found" : "missing"} (${clip(item.path, 54)})`,
	);
	return [
		"Guardian status",
		`Runtime: ${runtimeLabel}`,
		`Backend: ${snapshot.connected ? "online" : `offline - ${snapshot.message}`}`,
		`Model: ${model}`,
		`Requests: ${numberShort(snapshot.stats.totalRequests)}`,
		`Saved: ${money(snapshot.stats.totalSavedUsd)}`,
		`Spend: ${money(snapshot.stats.totalCostUsd)}`,
		`Cache hit rate: ${percent(snapshot.stats.cacheHitRate)}`,
		`Semantic Folding tokens saved: ${numberShort(snapshot.stats.totalTokensOptimized)}`,
		"",
		"Sibling repos",
		...siblingLines,
	].join("\n");
}

function dialogTitle(dialog: DialogMode): string {
	switch (dialog) {
		case "palette":
			return "Command Palette";
		case "help":
			return "Help";
		case "status":
			return "Status";
		case "fleet":
			return "Fleet";
		case "permission":
			return "Permission";
		case "sessions":
			return "Sessions";
		case "models":
			return "Models";
		case "connect":
			return "Connect";
		default:
			return "";
	}
}

function dialogText(
	dialog: DialogMode,
	draft: string,
	snapshot: GuardianSnapshot,
	siblings: SiblingStatus[],
	model: string,
	runtimeLabel: string,
	fleetText: string,
	permissionRequest: PermissionRequest | null,
	sessionsText: string,
): string {
	switch (dialog) {
		case "palette":
			return commandPaletteText(draft || "/");
		case "help":
			return commandHelp();
		case "status":
			return statusSummary(snapshot, siblings, model, runtimeLabel);
		case "fleet":
			return fleetText;
		case "permission":
			return permissionRequest
				? permissionPromptText(permissionRequest)
				: "No pending permission request.";
		case "sessions":
			return sessionsText;
		case "models":
			return modelSelectorText(snapshot, draft);
		case "connect":
			return connectText();
		default:
			return "";
	}
}

async function runShellCommand(command: string): Promise<string> {
	const trimmed = command.trim();
	if (!trimmed) return "Usage: !<command>";
	const shell =
		process.platform === "win32"
			? ["powershell.exe", "-NoProfile", "-Command", trimmed]
			: ["sh", "-lc", trimmed];
	const proc = Bun.spawn(shell, {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	const output = [
		`$ ${trimmed}`,
		`exit ${exitCode}`,
		stdout.trim(),
		stderr.trim() ? `stderr\n${stderr.trim()}` : "",
	]
		.filter(Boolean)
		.join("\n");
	const maxChars = 10_000;
	return output.length > maxChars
		? `${output.slice(0, maxChars)}\n\n[output truncated: ${output.length - maxChars} chars hidden]`
		: output;
}

async function enrichFileMentions(
	message: string,
	projectRoot: string,
): Promise<{ content: string; notes: string[] }> {
	const matches = [...message.matchAll(/@([^\s]+)/g)].map((match) => match[1]);
	if (matches.length === 0) return { content: message, notes: [] };
	const notes: string[] = [];
	const contexts: string[] = [];
	for (const rawPath of matches.slice(0, 5)) {
		const normalized = rawPath.replace(/^["']|["']$/g, "");
		const path = normalized.match(/^[A-Za-z]:[\\/]/)
			? normalized
			: `${projectRoot}\\${normalized}`;
		try {
			const file = Bun.file(path);
			if (!(await file.exists())) {
				notes.push(`Missing file: ${normalized}`);
				continue;
			}
			const text = await file.text();
			contexts.push(
				[
					`File: ${normalized}`,
					"```",
					text.slice(0, 12000),
					text.length > 12000 ? "\n[truncated]" : "",
					"```",
				].join("\n"),
			);
		} catch (error) {
			notes.push(
				error instanceof Error
					? `Could not read ${normalized}: ${error.message}`
					: `Could not read ${normalized}`,
			);
		}
	}
	if (contexts.length === 0) return { content: message, notes };
	return {
		content: `${message}\n\nAttached context:\n\n${contexts.join("\n\n")}`,
		notes,
	};
}

function renderFoldResult(result: FoldTextResult): string {
	return [
		"Semantic Folding",
		`Original tokens: ${numberShort(result.metadata.originalTokens)}`,
		`Folded tokens: ${numberShort(result.metadata.foldedTokens)}`,
		`Compression: ${percent(result.metadata.compressionRatio)}`,
		`Semantic density: ${percent(result.metadata.semanticDensity)}`,
		`Folding time: ${ms(result.foldingTimeMs)}`,
		`Headline: ${result.metadata.headline || "none"}`,
		`Entities: ${result.metadata.entities.join(", ") || "none"}`,
		`Actions: ${result.metadata.actions.join(", ") || "none"}`,
		"",
		result.foldedPrompt || "No folded output returned.",
	].join("\n");
}

function renderRail(
	snapshot: GuardianSnapshot,
	siblings: SiblingStatus[],
	model: string,
	agent: AgentDefinition,
	sending: boolean,
): string {
	const foundSiblings = siblings.filter((item) => item.exists).length;
	return [
		"Runtime",
		`Status       ${snapshot.connected ? "online" : "offline"}`,
		`Backend      ${clip(snapshot.message, 22)}`,
		`Agent        ${agent.title}`,
		`Model        ${clip(model, 22)}`,
		`State        ${sending ? "thinking" : "ready"}`,
		"",
		"Savings",
		`Spend        ${money(snapshot.stats.totalCostUsd)}`,
		`Saved        ${money(snapshot.stats.totalSavedUsd)}`,
		`Baseline     ${money(snapshot.stats.baselineCostUsd)}`,
		`Cache hits   ${percent(snapshot.stats.cacheHitRate)}`,
		`Tokens saved ${numberShort(snapshot.stats.totalTokensOptimized)}`,
		"",
		"Traffic",
		`Requests     ${numberShort(snapshot.stats.totalRequests)}`,
		`Latency      ${ms(snapshot.stats.avgLatencyMs)}`,
		`Providers    ${numberShort(snapshot.providers.length)}`,
		`Rules        ${numberShort(snapshot.rules.length)}`,
		"",
		"Trio",
		`Siblings     ${foundSiblings}/${siblings.length}`,
		`Updated      ${formatTime(snapshot.loadedAt)}`,
		"",
		"Quick",
		"tab agent",
		"ctrl+p commands",
	].join("\n");
}

function renderTranscript(turns: ChatTurn[]): string {
	return turns
		.slice(-12)
		.map((turn) => {
			const title =
				turn.role === "user"
					? "You"
					: turn.status === "pending"
						? "Guardian thinking"
						: "Guardian";
			const meta =
				turn.role === "assistant" && turn.status === "done"
					? [
							turn.model,
							turn.latencyMs ? ms(turn.latencyMs) : "",
							turn.costUsd ? money(turn.costUsd) : "",
							turn.savedUsd ? `saved ${money(turn.savedUsd)}` : "",
							turn.tokensSaved ? `${numberShort(turn.tokensSaved)} tokens saved` : "",
						]
							.filter(Boolean)
							.join("  ")
					: "";
			const body = turn.status === "pending" ? "Waiting on the model..." : turn.content;
			return [`${title}${meta ? `  ${meta}` : ""}`, body].join("\n");
		})
		.join("\n\n");
}

function exportMarkdown(turns: ChatTurn[]): string {
	const body = turns
		.filter((turn) => turn.id !== "welcome")
		.map((turn) => `## ${turn.role === "user" ? "You" : "Guardian"}\n\n${turn.content}`)
		.join("\n\n");
	return body || "No conversation messages yet.";
}

function screenForCommand(command: string): ScreenId | null {
	switch (command) {
		case "overview":
		case "usage":
		case "stats":
			return "overview";
		case "logs":
		case "requests":
			return "requests";
		case "savings":
		case "folding":
		case "vcm":
		case "cost":
		case "costs":
			return "savings";
		case "providers":
		case "provider":
		case "models":
		case "model-list":
			return "providers";
		case "budgets":
		case "budget":
			return "budgets";
		case "rules":
			return "rules";
		case "siblings":
		case "trio":
			return "siblings";
		default:
			return null;
	}
}

function chatHistory(
	turns: ChatTurn[],
	nextUserMessage: string,
	agent: AgentDefinition,
): ChatMessage[] {
	const prior = turns
		.filter(
			(turn) =>
				turn.id !== "welcome" &&
				turn.status !== "pending" &&
				turn.status !== "error",
		)
		.slice(-14)
		.map<ChatMessage>((turn) => ({
			role: turn.role,
			content: turn.content,
	}));
	return [systemPrompt(agent), ...prior, { role: "user", content: nextUserMessage }];
}

function renderSlashPopup(state: SlashState) {
	const rows = visibleSlashMatches(state);
	const selected = selectedSlashCommand(state);
	return Box(
		{
			id: "guardian-slash-popup",
			width: "64%",
			minWidth: 62,
			maxWidth: 100,
			height: 14,
			border: true,
			borderStyle: "single",
			borderColor: theme.popupBorder,
			backgroundColor: theme.panelAlt,
			paddingX: 1,
			flexDirection: "column",
		},
		Text({
			content: "Slash commands",
			fg: theme.commandCategory,
			wrapMode: "none",
		}),
		...rows.map((match, index) => {
			const absoluteIndex = state.scrollOffset + index;
			const isSelected = absoluteIndex === state.highlightedIndex;
			return Text({
				content: renderSlashRow(match, isSelected),
				fg: match.command.enabled
					? isSelected
						? theme.commandName
						: theme.text
					: theme.commandDisabled,
				bg: isSelected ? theme.popupFocus : theme.panelAlt,
				wrapMode: "none",
			});
		}),
		Text({
			content:
				selected && !selected.enabled
					? selected.disabledReason || "Command is unavailable."
				: "up/down select | tab complete | enter run | esc close",
			fg: selected && !selected.enabled ? theme.amber : theme.muted,
			wrapMode: "none",
		}),
	);
}

function renderFilePickerPopup(state: FilePickerState): string {
	const rows = state.matches.slice(state.scrollOffset, state.scrollOffset + state.pageSize);
	return [
		"Files",
		...rows.map((file, index) => {
			const absoluteIndex = state.scrollOffset + index;
			const prefix = absoluteIndex === state.highlightedIndex ? "> " : "  ";
			return `${prefix}@${file.path}  ${numberShort(file.size)}b`;
		}),
		rows.length === 0 ? "  No files match." : "",
		"",
		"up/down select | tab/enter attach | esc close",
	]
		.filter(Boolean)
		.join("\n");
}

function modelSelectorText(snapshot: GuardianSnapshot, query = ""): string {
	const bare = query.trim().replace(/^\/models?/, "").trim().toLowerCase();
	const providers = snapshot.providers
		.filter((item) => {
			if (!bare) return true;
			return (
				item.model.toLowerCase().includes(bare) ||
				item.provider.toLowerCase().includes(bare)
			);
		})
		.slice(0, 18);
	return [
		"Models",
		"Use /model <provider/model> to select. Use /models --refresh to refresh OpenRouter catalog.",
		"",
		"MODEL                               CTX       INPUT/1M   OUTPUT/1M  CAPS",
		...providers.map((item) =>
			[
				clip(item.model, 34).padEnd(34),
				Number.isFinite(item.contextWindow)
					? numberShort(item.contextWindow ?? 0).padStart(8)
					: "unknown ".padStart(8),
				money(item.inputPerMillion).padStart(10),
				money(item.outputPerMillion).padStart(10),
				[item.supportsTools ? "tools" : "", item.supportsVision ? "vision" : ""]
					.filter(Boolean)
					.join(","),
			].join("  "),
		),
	].join("\n");
}

function connectText(): string {
	return [
		"Connect Providers",
		"",
		"OpenRouter is supported first.",
		"PowerShell:",
		"  setx OPENROUTER_API_KEY \"your-key\"",
		"",
		"Current fallback order:",
		"- OpenRouter via OPENROUTER_API_KEY",
		"- OpenAI, Anthropic, and Gemini provider setup are next",
		"",
		"After setting a key, restart Guardian or run /status.",
	].join("\n");
}

export async function launchGuardianTui(options: GuardianTuiOptions = {}): Promise<void> {
	const projectRoot = getProjectRoot();
	const config = loadGuardianConfig(options);
	const customCommands = loadProjectCommands(projectRoot);
	setCustomCommands(customCommands.map((command) => command.definition));
	const fileIndex = scanProjectFiles(projectRoot);
	const adminKey = resolveAdminKey(config, options.adminKey);
	const siblings = discoverSiblings(projectRoot, config);
	const useRemoteApi = Boolean(options.apiUrl || process.env.GUARDIAN_API_URL);
	const runtimeLabel = useRemoteApi
		? `remote API ${config.apiUrl}`
		: "local in-process runtime";
	const client: GuardianClient = useRemoteApi
		? new GuardianApiClient(config.apiUrl, adminKey)
		: new LocalGuardianClient();
	let mode: ConsoleMode = "chat";
	let agent =
		findAgent(options.agent ?? "") ??
		agentRegistry.find((item) => item.id === "build") ??
		agentRegistry[0];
	let model = options.model ?? config.defaultModel;
	let snapshot = initialSnapshot();
	let inputRenderable: InputRenderable | null = null;
	let draft = "";
	let dialog: DialogMode = null;
	let slashState = createSlashState("");
	let filePickerState = createFilePickerState("", fileIndex);
	let slashDismissedValue = "";
	let fleetText = renderFleetPlan(createFleetPlan([], initialSnapshot()));
	let activeFleetRun: FleetRun | null = null;
	let attachedFiles: AttachedFile[] = [];
	let pendingShell: string | null = null;
	let permissionRequest: PermissionRequest | null = null;
	let sessionsText = "";
	const patchHistory = new PatchHistory();
	let refreshing = false;
	let sending = false;
	let turnCounter = 0;
	let session: GuardianSession = {
		id: createSessionId(),
		title: "New Guardian session",
		model,
		agent: agent.id,
		turns: [welcomeTurn()],
		attachedFiles: [],
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};
	if (options.sessionId || options.continueLast) {
		const loaded = options.sessionId
			? loadSession(projectRoot, options.sessionId)
			: latestSession(projectRoot);
		if (loaded) {
			session = options.forkSession
				? { ...loaded, id: createSessionId(), forkedFrom: loaded.id }
				: loaded;
			model = session.model;
			agent = findAgent(session.agent) ?? agent;
		}
	}
	let turns: ChatTurn[] = session.turns.length > 0 ? session.turns : [welcomeTurn()];

	const renderer = await createCliRenderer({
		exitOnCtrlC: true,
		clearOnShutdown: true,
		targetFps: 30,
		backgroundColor: theme.background,
	});
	renderer.setTerminalTitle("Guardian");

	const captureDraft = () => {
		if (inputRenderable) draft = inputRenderable.value;
		slashState = createSlashState(draft, slashState);
		filePickerState = createFilePickerState(draft, fileIndex, filePickerState);
		if (draft === slashDismissedValue) {
			slashState = { ...slashState, open: false };
		}
	};

	const setDraft = (value: string) => {
		draft = value;
		if (draft !== slashDismissedValue) slashDismissedValue = "";
		if (inputRenderable) inputRenderable.value = value;
		slashState = createSlashState(draft, slashState);
		filePickerState = createFilePickerState(draft, fileIndex, filePickerState);
		if (draft === slashDismissedValue) {
			slashState = { ...slashState, open: false };
		}
	};

	const render = () => {
		captureDraft();
		removeChildren(renderer.root);
		const isLanding = mode === "chat" && turns.length === 1;
		const statusLine = [
			agent.title,
			model,
			snapshot.connected ? "online" : "offline",
			`saved ${money(snapshot.stats.totalSavedUsd)}`,
			"Folding",
			"VCM",
		].join("  ");
		const panelTitle =
			mode === "chat"
				? "Chat"
				: mode === "requests"
					? "Live Requests"
					: mode.charAt(0).toUpperCase() + mode.slice(1);
		const panelText =
			mode === "chat" ? renderTranscript(turns) : renderScreen(mode, snapshot, siblings);
		const activeDialogText = dialogText(
			dialog,
			draft,
			snapshot,
			siblings,
			model,
			runtimeLabel,
			fleetText,
			permissionRequest,
			sessionsText,
		);
		const app = Box(
			{
				id: "guardian-root",
				width: "100%",
				height: "100%",
				flexDirection: "column",
				backgroundColor: theme.background,
				padding: 1,
				gap: 1,
			},
			Box(
				{
					id: "guardian-body",
					flexGrow: 1,
					flexDirection: "column",
					alignItems: "center",
					justifyContent: isLanding ? "center" : "flex-start",
					gap: isLanding ? 2 : 1,
				},
				isLanding
					? ASCIIFont({
							text: "Guardian",
							font: "block",
							color: [theme.dim, theme.text, theme.green],
							backgroundColor: theme.background,
						})
					: Box(
							{
								id: "guardian-workspace",
								width: "100%",
								flexGrow: 1,
								flexDirection: "row",
								gap: 1,
							},
							Box(
								{
									id: "guardian-main",
									flexGrow: 1,
									border: false,
									backgroundColor: theme.background,
									paddingX: 1,
									flexDirection: "column",
								},
								Text({
									content: panelTitle,
									fg: mode === "chat" ? theme.green : theme.cyan,
									wrapMode: "none",
								}),
								Text({
									content: "",
									fg: theme.dim,
								}),
								Text({
									content: panelText,
									fg: theme.text,
									wrapMode: "word",
								}),
							),
							Box(
								{
									id: "guardian-rail",
									width: 34,
									border: false,
									backgroundColor: theme.background,
									padding: 1,
								},
								Text({
									content: renderRail(snapshot, siblings, model, agent, sending),
									fg: theme.muted,
									wrapMode: "word",
								}),
							),
						),
				dialog
					? Box(
							{
								id: "guardian-dialog",
								width: "72%",
								minWidth: 70,
								maxWidth: 118,
								height: dialog === "fleet" ? 22 : dialog === "help" ? 18 : 14,
								border: true,
								borderStyle: "single",
								borderColor: theme.cyan,
								backgroundColor: theme.panelAlt,
								padding: 1,
								flexDirection: "column",
							},
							Text({
								content: `${dialogTitle(dialog)}   esc close`,
								fg: theme.green,
								wrapMode: "none",
							}),
							Text({
								content: "",
								fg: theme.dim,
							}),
							Text({
								content: activeDialogText,
								fg: theme.text,
								wrapMode: "word",
							}),
						)
					: Text({
							content: "",
							fg: theme.dim,
						}),
				slashState.open ? renderSlashPopup(slashState) : Text({
					content: "",
					fg: theme.dim,
				}),
				filePickerState.open
					? Box(
							{
								id: "guardian-file-popup",
								width: "64%",
								minWidth: 62,
								maxWidth: 100,
								height: 12,
								border: true,
								borderStyle: "single",
								borderColor: theme.popupBorder,
								backgroundColor: theme.panelAlt,
								paddingX: 1,
							},
							Text({
								content: renderFilePickerPopup(filePickerState),
								fg: theme.text,
								wrapMode: "none",
							}),
						)
					: Text({
							content: "",
							fg: theme.dim,
						}),
				Box(
					{
						id: "guardian-prompt-card",
						width: "64%",
						minWidth: 62,
						maxWidth: 100,
						height: slashState.open ? 5 : 5,
						border: true,
						borderStyle: "single",
						borderColor: sending ? theme.amber : theme.blue,
						backgroundColor: theme.panel,
						paddingX: 1,
						flexDirection: "column",
					},
					Input({
						id: "guardian-prompt",
						width: "100%",
						value: draft,
						maxLength: 4000,
						placeholder: 'Ask anything... "Fix broken tests"',
						backgroundColor: theme.panel,
						textColor: theme.text,
						focusedBackgroundColor: theme.panel,
						focusedTextColor: theme.text,
						placeholderColor: theme.muted,
					}),
					Text({
						content: statusLine,
						fg: snapshot.connected ? theme.green : theme.amber,
						wrapMode: "none",
					}),
					Text({
						content: renderAttachedFiles(attachedFiles),
						fg: theme.cyan,
						wrapMode: "none",
					}),
					slashState.open
						? Text({
								content: "up/down select | tab complete | enter run | esc close",
								fg: theme.cyan,
								wrapMode: "none",
							})
						: Text({
								content: "tab agents   ctrl+p commands   @ files   ! shell",
								fg: theme.muted,
								wrapMode: "none",
							}),
				),
				isLanding
					? Text({
							content:
								snapshot.connected
									? "Tip  Guardian routes prompts through folding, sharding, cache, and budgets."
									: `Tip  Start the local server with guardian start server. ${snapshot.message}`,
							fg: snapshot.connected ? theme.muted : theme.amber,
							wrapMode: "word",
						})
					: Text({
							content: `${snapshot.stats.totalRequests} req  ${money(snapshot.stats.totalSavedUsd)} saved  ${siblings.filter((item) => item.exists).length} siblings  /status`,
							fg: theme.muted,
							wrapMode: "none",
						}),
			),
			Box(
				{
					id: "guardian-footer",
					height: 1,
					width: "100%",
					flexDirection: "row",
					justifyContent: "space-between",
				},
				Text({
					content: `~  ${siblings.filter((item) => item.exists).length} MCP  /status`,
					fg: theme.muted,
					wrapMode: "none",
				}),
				Text({
					content: "0.1.0",
					fg: theme.dim,
					wrapMode: "none",
				}),
			),
		);
		renderer.root.add(app);
		const prompt = renderer.root.findDescendantById("guardian-prompt");
		inputRenderable = prompt ? (prompt as InputRenderable) : null;
		inputRenderable?.on(InputRenderableEvents.INPUT, (value: string) => {
			draft = value;
			if (draft !== slashDismissedValue) slashDismissedValue = "";
			slashState = createSlashState(draft, slashState);
			filePickerState = createFilePickerState(draft, fileIndex, filePickerState);
		});
		inputRenderable?.on(InputRenderableEvents.CHANGE, (value: string) => {
			draft = value;
			if (draft !== slashDismissedValue) slashDismissedValue = "";
			slashState = createSlashState(draft, slashState);
			filePickerState = createFilePickerState(draft, fileIndex, filePickerState);
		});
		inputRenderable?.on(InputRenderableEvents.ENTER, (value: string) => {
			draft = value;
			void handleSubmit();
		});
		inputRenderable?.focus();
		renderer.root.requestRender();
	};

	const refresh = async (forceRender = true) => {
		if (refreshing) return;
		captureDraft();
		refreshing = true;
		if (forceRender && draft.length === 0) render();
		snapshot = await client.snapshot();
		refreshing = false;
		if (forceRender && draft.length === 0) render();
	};

	const pushAssistant = (content: string) => {
		turns.push({
			id: `assistant-${++turnCounter}`,
			role: "assistant",
			status: "done",
			content,
		});
	};

	const persistSession = () => {
		session = {
			...session,
			title: titleFromTurns(turns),
			model,
			agent: agent.id,
			turns,
			attachedFiles: attachedFiles.map((file) => ({
				path: file.path,
				size: file.size,
				truncated: file.truncated,
			})),
			updatedAt: new Date().toISOString(),
		};
		saveSession(projectRoot, session);
	};

	const handleCommand = async (raw: string): Promise<boolean> => {
		const [command = "", ...args] = raw.slice(1).trim().split(/\s+/);
		const normalized = command.toLowerCase();
		if (!normalized) return false;
		const commandDef = findCommand(normalized);
		if (commandDef && !commandDef.enabled) {
			mode = "chat";
			dialog = null;
			pushAssistant(
				`${commandDef.name} is planned.\n\n${commandDef.disabledReason ?? commandDef.description}`,
			);
			return true;
		}
		if (normalized === "help" || normalized === "?") {
			mode = "chat";
			dialog = "help";
			return true;
		}
		if (normalized === "chat") {
			mode = "chat";
			dialog = null;
			return true;
		}
		if (normalized === "clear" || normalized === "new" || normalized === "reset") {
			mode = "chat";
			dialog = null;
			turns = [welcomeTurn()];
			return true;
		}
		if (normalized === "status" || normalized === "doctor") {
			mode = "chat";
			dialog = "status";
			return true;
		}
		if (normalized === "refresh") {
			await refresh(false);
			pushAssistant("Telemetry refreshed.");
			persistSession();
			return true;
		}
		if (normalized === "models" || normalized === "providers") {
			if (args.includes("--refresh")) {
				await refresh(false);
			}
			mode = "chat";
			dialog = "models";
			return true;
		}
		if (normalized === "connect") {
			mode = "chat";
			dialog = "connect";
			return true;
		}
		if (normalized === "files") {
			mode = "chat";
			dialog = null;
			setDraft("@");
			return true;
		}
		if (normalized === "shell") {
			mode = "chat";
			dialog = null;
			setDraft("!");
			return true;
		}
		if (normalized === "model") {
			const nextModel = args.join(" ").trim();
			if (nextModel.length === 0) {
				pushAssistant(`Current model: ${model}`);
			} else {
				model = nextModel;
				pushAssistant(`Model set to ${model}.`);
			}
			persistSession();
			return true;
		}
		if (normalized === "agent" || normalized === "agents") {
			const nextAgent = args.join(" ").trim().toLowerCase();
			if (nextAgent.length === 0) {
				pushAssistant(["Agents", "", agentHelp(), "", `Current agent: ${agent.title}`].join("\n"));
				return true;
			}
			const found = findAgent(nextAgent);
			if (!found) {
				pushAssistant(`Usage: /agent build|plan|audit|fleet\n\n${agentHelp()}`);
				return true;
			}
			agent = found;
			pushAssistant(`Agent set to ${agent.title}.`);
			persistSession();
			return true;
		}
		if (normalized === "fleet") {
			mode = "chat";
			const plan = createFleetPlan(args, snapshot);
			if (plan.mode === "cancel") {
				activeFleetRun = cancelFleetRun(activeFleetRun);
				fleetText = renderFleetRun(activeFleetRun);
			} else if (args.includes("--dry-run") || args.includes("--run")) {
				activeFleetRun = createFleetRun(plan, projectRoot);
				if (args.includes("--execute-readonly")) {
					activeFleetRun = await executeReadOnlyFleetRun(activeFleetRun, client);
				}
				fleetText = renderFleetRun(activeFleetRun);
			} else {
				fleetText = renderFleetPlan(plan);
			}
			dialog = "fleet";
			return true;
		}
		if (
			normalized === "sessions" ||
			normalized === "resume" ||
			normalized === "continue"
		) {
			if (normalized === "sessions") {
				sessionsText = renderSessions(listSessions(projectRoot));
				dialog = "sessions";
				return true;
			}
			const target =
				normalized === "continue"
					? latestSession(projectRoot)
					: loadSession(projectRoot, args[0] ?? "");
			if (!target) {
				pushAssistant("No matching session found.");
				persistSession();
				return true;
			}
			session = target;
			turns = target.turns;
			model = target.model;
			agent = findAgent(target.agent) ?? agent;
			pushAssistant(`Resumed session ${target.id}.`);
			persistSession();
			return true;
		}
		if (normalized === "fork") {
			const oldId = session.id;
			session = {
				...session,
				id: createSessionId(),
				forkedFrom: oldId,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};
			pushAssistant(`Forked session ${oldId} -> ${session.id}.`);
			persistSession();
			return true;
		}
		if (normalized === "export") {
			pushAssistant(["Conversation export", "", exportMarkdown(turns)].join("\n"));
			return true;
		}
		if (normalized === "init") {
			const path = initGuardianNotes(projectRoot);
			pushAssistant(`Initialized Guardian notes at ${path}.`);
			persistSession();
			return true;
		}
		if (normalized === "permissions") {
			pushAssistant(
				[
					"Permissions",
					"read: allow",
					"shell: ask",
					"edit: ask",
					"web: ask",
					"mcp: ask",
					"fleet: ask",
					"git: ask",
				].join("\n"),
			);
			persistSession();
			return true;
		}
		if (normalized === "diff") {
			try {
				pushAssistant(["Git diff", "", await gitDiff()].join("\n"));
			} catch (error) {
				pushAssistant(error instanceof Error ? `Diff failed: ${error.message}` : "Diff failed.");
			}
			persistSession();
			return true;
		}
		if (normalized === "undo") {
			pushAssistant(patchHistory.undo());
			persistSession();
			return true;
		}
		if (normalized === "redo") {
			pushAssistant(patchHistory.redo());
			persistSession();
			return true;
		}
		if (normalized === "review") {
			try {
				const diff = await gitDiff();
				const reviewPrompt = `Audit this git diff for bugs, regressions, security issues, and missing tests.\n\n${diff}`;
				turns.push({
					id: `user-${++turnCounter}`,
					role: "user",
					status: "done",
					content: "/review current diff",
				});
				const response = await client.chat(
					[systemPrompt(findAgent("audit") ?? agent), { role: "user", content: reviewPrompt }],
					model,
				);
				pushAssistant(response.content);
			} catch (error) {
				pushAssistant(error instanceof Error ? `Review failed: ${error.message}` : "Review failed.");
			}
			persistSession();
			return true;
		}
		const custom = customCommands.find((item) => item.definition.name === `/${normalized}`);
		if (custom) {
			const prompt = renderCustomCommand(custom.promptTemplate, args.join(" "));
			turns.push({
				id: `user-${++turnCounter}`,
				role: "user",
				status: "done",
				content: custom.definition.name,
			});
			const response = await client.chat([...chatHistory(turns, prompt, agent)], model);
			pushAssistant(response.content);
			persistSession();
			return true;
		}
		if (normalized === "fold" || normalized === "compact") {
			const text = args.join(" ").trim();
			if (text.length === 0) {
				pushAssistant("Usage: /compact <text>");
				return true;
			}
			try {
				const result = await client.foldText(text);
				mode = "chat";
				pushAssistant(renderFoldResult(result));
			} catch (error) {
				pushAssistant(
					error instanceof Error
						? `Folding failed: ${error.message}`
						: "Folding failed.",
				);
			}
			return true;
		}
		if (normalized === "quit" || normalized === "exit" || normalized === "q") {
			renderer.destroy();
			return true;
		}
		const nextScreen = screenForCommand(normalized);
		if (nextScreen) {
			mode = nextScreen;
			dialog = null;
			return true;
		}
		pushAssistant(`Unknown command: /${normalized}\n\n${commandHelp()}`);
		return true;
	};

	const runSlashCommand = async (command: CommandDefinition, raw?: string) => {
		if (!command.enabled) {
			pushAssistant(
				`${command.name} is planned.\n\n${command.disabledReason ?? command.description}`,
			);
			render();
			return;
		}
		await handleCommand(raw || command.name);
		render();
	};

	const executeShell = async (command: string) => {
		mode = "chat";
		dialog = null;
		permissionRequest = null;
		pendingShell = null;
		turns.push({
			id: `user-${++turnCounter}`,
			role: "user",
			status: "done",
			content: `!${command}`,
		});
		const assistantTurn: ChatTurn = {
			id: `assistant-${++turnCounter}`,
			role: "assistant",
			status: "pending",
			content: "",
		};
		turns.push(assistantTurn);
		sending = true;
		render();
		try {
			Object.assign(assistantTurn, {
				status: "done",
				content: await runShellCommand(command),
			});
		} catch (error) {
			Object.assign(assistantTurn, {
				status: "error",
				content:
					error instanceof Error
						? `Shell command failed: ${error.message}`
						: "Shell command failed.",
			});
		} finally {
			sending = false;
			persistSession();
			render();
		}
	};

	const handleSubmit = async () => {
		if (sending) return;
		captureDraft();
		const raw = draft.trim();
		if (!raw) return;
		setDraft("");
		if (raw.startsWith("/") && (await handleCommand(raw))) {
			if (dialog !== "help" && dialog !== "status" && dialog !== "fleet") dialog = null;
			render();
			return;
		}
		if (raw.startsWith("!")) {
			const command = raw.slice(1).trim();
			const request = classifyShellCommand(command);
			if (isDenied(request, defaultPermissions)) {
				pushAssistant(`Shell denied: ${command}`);
				persistSession();
				render();
				return;
			}
			pendingShell = command;
			permissionRequest = request;
			if (canAutoAllow(request, defaultPermissions)) {
				await executeShell(command);
			} else {
				dialog = "permission";
				render();
			}
			return;
		}
		if (raw.startsWith("@") && !raw.includes(" ")) {
			const invokedAgent = findAgent(raw);
			if (invokedAgent) {
				agent = invokedAgent;
				pushAssistant(`Agent set to ${agent.title}.`);
				persistSession();
				render();
				return;
			}
		}

		mode = "chat";
		const attachedContext = attachedFilesContext(attachedFiles);
		const enriched = await enrichFileMentions(
			attachedContext ? `${raw}\n\n${attachedContext}` : raw,
			projectRoot,
		);
		for (const note of enriched.notes) {
			pushAssistant(note);
		}
		const messages = chatHistory(turns, enriched.content, agent);
		const userTurn: ChatTurn = {
			id: `user-${++turnCounter}`,
			role: "user",
			status: "done",
			content: raw,
		};
		const assistantTurn: ChatTurn = {
			id: `assistant-${++turnCounter}`,
			role: "assistant",
			status: "pending",
			content: "",
		};
		turns.push(userTurn, assistantTurn);
		sending = true;
		render();

		try {
			const response = await client.chat(messages, model);
			Object.assign(assistantTurn, {
				status: "done",
				content: response.content,
				model: response.model,
				costUsd: response.costUsd,
				savedUsd: response.savedUsd,
				latencyMs: response.latencyMs,
				tokensSaved: response.tokensSaved,
			});
			model = response.model || model;
			attachedFiles = [];
			await refresh(false);
			persistSession();
		} catch (error) {
			Object.assign(assistantTurn, {
				status: "error",
				content:
					error instanceof Error
						? `Model call failed: ${error.message}`
						: "Model call failed.",
			});
		} finally {
			sending = false;
			persistSession();
			render();
		}
	};

	renderer.prependInputHandler((sequence) => {
		if (dialog === "permission" && permissionRequest) {
			if (sequence.toLowerCase() === "y" && pendingShell) {
				void executeShell(pendingShell);
				return true;
			}
			if (sequence.toLowerCase() === "n" || sequence === "\u001b") {
				pushAssistant(
					`Permission denied: ${permissionRequest.command ?? permissionRequest.action}`,
				);
				permissionRequest = null;
				pendingShell = null;
				dialog = null;
				persistSession();
				render();
				return true;
			}
		}
		const fileKeyMap: Record<string, "up" | "down" | "accept" | "escape"> = {
			"\u001b[A": "up",
			"\u001b[B": "down",
			"\t": "accept",
			"\r": "accept",
			"\n": "accept",
			"\u001b": "escape",
		};
		const fileAction = filePickerState.open ? fileKeyMap[sequence] : undefined;
		if (fileAction) {
			if (fileAction === "up") filePickerState = moveFileHighlight(filePickerState, -1);
			if (fileAction === "down") filePickerState = moveFileHighlight(filePickerState, 1);
			if (fileAction === "escape") {
				filePickerState = { ...filePickerState, open: false };
			}
			if (fileAction === "accept") {
				const file = selectedFile(filePickerState);
				if (file) {
					try {
						attachedFiles = [...attachedFiles, attachFile(projectRoot, file)].slice(-8);
						setDraft("");
						filePickerState = { ...filePickerState, open: false };
					} catch (error) {
						pushAssistant(error instanceof Error ? `Attach failed: ${error.message}` : "Attach failed.");
					}
				}
			}
			render();
			return true;
		}
		const slashKeyMap: Record<string, SlashAction> = {
			"\u001b[A": "up",
			"\u001b[B": "down",
			"\u001b[5~": "page-up",
			"\u001b[6~": "page-down",
			"\u0015": "page-up",
			"\u0004": "page-down",
			"\t": "complete",
			"\r": "enter",
			"\n": "enter",
			"\u001b": "escape",
			"\u007f": "backspace",
			"\b": "backspace",
		};
		const slashAction = slashState.open ? slashKeyMap[sequence] : undefined;
		if (slashAction) {
			const result = reduceSlashState(slashState, slashAction);
			slashState = result.state;
			if (result.insertText !== undefined) {
				setDraft(result.insertText);
			}
			if (result.close) {
				if (slashAction === "escape") slashDismissedValue = draft;
				slashState = { ...slashState, open: false };
			}
			if (result.runCommand) {
				setDraft("");
				void runSlashCommand(result.runCommand, result.runText);
				return true;
			}
			if (result.handled) {
				render();
				return true;
			}
		}
		if (sequence === "\u001b") {
			mode = "chat";
			dialog = null;
			render();
			return true;
		}
		if (sequence === "\t" || sequence === "\u0014") {
			agent = nextAgent(agent);
			persistSession();
			render();
			return true;
		}
		if (sequence === "\u0010") {
			dialog = dialog === "palette" ? null : "palette";
			if (dialog === "palette" && draft.length === 0) setDraft("/");
			render();
			return true;
		}
		if (sequence === "\u000c") {
			mode = "chat";
			turns = [welcomeTurn()];
			setDraft("");
			dialog = null;
			render();
			return true;
		}
		if (sequence === "\u0012") {
			void refresh(false).then(() => {
				pushAssistant("Telemetry refreshed.");
				render();
			});
			return true;
		}
		return false;
	});

	render();
	await refresh();
	if (options.prompt) {
		setDraft(options.prompt);
		await handleSubmit();
	}
	const timer = setInterval(() => {
		captureDraft();
		if (draft.length === 0 && !sending) {
			void refresh();
		}
	}, config.refreshMs);
	renderer.on("destroy", () => clearInterval(timer));
	renderer.start();
}
