// Interactive TUI for the guardian CLI.
//
// This is what a bare `guardian` runs. Unlike ./splash.ts — which composes one
// static frame of text and exits — this mounts a live chat application: it
// stays resident, accepts typed prompts, streams model replies, reflows on
// window resize, and only exits when you ask it to.
//
// Why a renderer instead of `console.log`
// ---------------------------------------
// The static splash measured `process.stdout.columns` exactly once, at compose
// time, so a resized window left the old geometry frozen on screen. Here every
// dimension is declarative — `width: "47%"`, `flexGrow: 1` — and the layout
// engine recomputes cell positions on each resize event. Nothing in this file
// reads terminal dimensions directly.
//
// What a prompt does
// ------------------
// The conversation layer lives in ./chat-session.ts. Submitting a prompt runs:
//
//   retain-filter → fold (if large) → shard (if larger) → budget guard →
//   streamComplete(model) → stream reply into the transcript
//
// The provider boundary is the OpenAI-compatible chat-completions format, so
// OpenRouter, OpenAI, Anthropic (via the OpenRouter proxy), and local runtimes
// all work through the same path. `/models` opens an interactive picker over
// the full model catalog (static fingerprints + live OpenRouter listing);
// `/model <id>` switches directly by id; `/clear` resets the conversation.
//
// Layout tree
// -----------
//   root (column, centered, page background)
//     wordmark              — block letters, left-to-right ramp (splash state)
//     transcript (grow)     — scrollable conversation (chat state)
//     slab (row)  47%       — bar | input + status
//     hints       47%       — right-aligned key/action pairs
//     footer      100%      — cwd left, version right
//
// Colors come from `palette` in ./theme.ts — the same hex values the ANSI path
// uses, so the two rendering paths cannot drift.

import {
	BoxRenderable,
	type CliRenderer,
	CliRenderEvents,
	InputRenderable,
	InputRenderableEvents,
	type KeyEvent,
	ScrollBoxRenderable,
	StyledText,
	TextRenderable,
	bold,
	createCliRenderer,
	fg,
} from "@opentui/core";
import { mix, palette } from "./theme.ts";
import { homeRelative, rasterizeWordmark } from "./ui.ts";
import {
	type ChatSession,
	type TurnMetrics,
	createChatSession,
	summarizeTurn,
} from "./chat-session.ts";
import {
	type ModelListing,
	type ModelPickerHandles,
	createModelPicker,
} from "./model-picker.ts";

/** Slab and hints width as a fraction of the viewport. */
const PANEL_PERCENT = "47%" as const;

/** Transcript width — wider than the slab so replies have room. */
const TRANSCRIPT_PERCENT = "80%" as const;

/** Width of the right-aligned role column in the transcript ("anthropic ›"). */
const LABEL_WIDTH = 14;

/** Braille spinner frames for the busy status line. */
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

/**
 * Keybinding hints under the slab, as `[key, action]` pairs. Kept short enough
 * to fit the slab's width on a typical 100-column terminal.
 */
const HINTS: readonly (readonly [string, string])[] = [
	["enter", "send"],
	["/models", ""],
	["/clear", ""],
	["ctrl+c", "quit"],
];

/** Never let the slab (or the hints aligned to it) get narrower than this. */
const PANEL_MIN = 46;

/** Hints as styled chunks: key bright, action muted — same as the ANSI path. */
function hintsText(pairs: readonly (readonly [string, string])[]): StyledText {
	const chunks = pairs.flatMap(([key, action], i) => [
		fg(palette.text)(key),
		fg(palette.textMuted)(
			`${action ? ` ${action}` : ""}${i < pairs.length - 1 ? "   " : ""}`,
		),
	]);
	return new StyledText(chunks);
}

export type TuiOptions = {
	/** Version shown at the footer's right edge. */
	version: string;
	/** Starting model id. */
	model?: string;
	/** Provider label, shown dimmest when idle. */
	provider?: string;
	/**
	 * Custom OpenAI-compatible base URL. When set, the chat session pins every
	 * request to this endpoint (model IDs sent unchanged, ambient keys not
	 * forwarded) — used for LM Studio / Ollama / self-hosted servers.
	 */
	baseUrl?: string;
	/** API key for the custom endpoint. Omit for keyless local runtimes. */
	apiKey?: string;
	/** Injectable session factory — tests stub the network here. */
	createSession?: (model: string) => ChatSession;
	/**
	 * Injectable model source for the `/models` picker. Defaults to the real
	 * catalog (static fingerprints + live OpenRouter listing); tests inject a
	 * static list so the picker runs offline.
	 */
	listModels?: () => Promise<ModelListing[]>;
};

/**
 * Build the wordmark as three `StyledText` rows with a per-CELL brightness ramp.
 *
 * The geometry comes from `rasterizeWordmark` in ./ui.ts — the same bitmap the
 * ANSI path uses — so the TUI and `console.log` render identical letterforms.
 */
function wordmarkRows(word: string): { rows: StyledText[]; width: number } {
	const { rows, width } = rasterizeWordmark(word);
	const ramp = (x: number) =>
		mix(
			palette.wordmarkFrom,
			palette.wordmarkTo,
			width > 1 ? x / (width - 1) : 1,
		);

	return {
		width,
		rows: rows.map(
			(row) => new StyledText([...row].map((cell, x) => fg(ramp(x))(cell))),
		),
	};
}

/**
 * Handles onto the mutable parts of the layout, returned by `mountTui` so both
 * the live runner and the tests can drive and inspect the same tree.
 */
export type TuiHandles = {
	input: InputRenderable;
	status: TextRenderable;
	tip: TextRenderable;
	slab: BoxRenderable;
	wordmark: BoxRenderable;
	/** One-line brand header that replaces the wordmark once a chat starts. */
	header: BoxRenderable;
	transcript: ScrollBoxRenderable;
	session: ChatSession;
	/** The model picker overlay — tests drive `/models` through this. */
	picker: ModelPickerHandles;
	/** Submit the input's current value, as pressing enter would. */
	submit: () => Promise<void>;
};

/**
 * Whether a keypress should quit the TUI.
 *
 * Exported so the exit contract is testable: driving a real Ctrl+C through a
 * pseudo-terminal is unreliable, but the predicate is the whole decision.
 */
export function isQuitKey(key: Pick<KeyEvent, "name" | "ctrl">): boolean {
	return (key.ctrl && key.name === "c") || key.name === "escape";
}

/** A slash command, or null if the text isn't one. */
function parseCommand(text: string): { name: string; arg: string } | null {
	if (!text.startsWith("/")) return null;
	const space = text.indexOf(" ");
	const name = (space === -1 ? text : text.slice(0, space)).toLowerCase();
	const arg = space === -1 ? "" : text.slice(space + 1).trim();
	return { name, arg };
}

/**
 * Build the layout tree into an existing renderer and wire up behavior.
 *
 * Split out from `runTui` so tests can mount the exact same tree into the
 * library's test renderer, capture frames, and drive resizes.
 */
export function mountTui(renderer: CliRenderer, opts: TuiOptions): TuiHandles {
	const { version, model: startModel = "anthropic/claude-sonnet-4-5" } = opts;

	const session = (opts.createSession ??
		((m) =>
			createChatSession({
				model: m,
				baseUrl: opts.baseUrl,
				apiKey: opts.apiKey,
			})))(startModel);

	// ─── Layout ──────────────────────────────────────────────────────────────

	const root = new BoxRenderable(renderer, {
		id: "root",
		width: "100%",
		height: "100%",
		flexDirection: "column",
		alignItems: "center",
		backgroundColor: palette.background,
	});
	renderer.root.add(root);

	// Idle-only spacers share the free height 36/64, the same proportions as the
	// static splash: the composition sits above center and the footer stays
	// anchored to the bottom row. They're hidden in chat, where the transcript
	// takes the free space instead.
	const topSpacer = new BoxRenderable(renderer, {
		id: "spacer-top",
		flexGrow: 36,
		flexShrink: 1,
	});
	root.add(topSpacer);

	// Wordmark: three rows of half blocks, per-cell ramp.
	const mark = wordmarkRows("guardian");
	const wordmark = new BoxRenderable(renderer, {
		id: "wordmark",
		flexDirection: "column",
		width: mark.width,
		flexShrink: 0,
	});
	root.add(wordmark);
	mark.rows.forEach((row, i) => {
		wordmark.add(
			new TextRenderable(renderer, { id: `wordmark-${i}`, content: row }),
		);
	});

	// Compact header: once a conversation starts the three-row wordmark would
	// eat a quarter of a small terminal, so it gives way to a single line.
	const header = new BoxRenderable(renderer, {
		id: "header",
		width: TRANSCRIPT_PERCENT,
		flexDirection: "row",
		justifyContent: "space-between",
		marginTop: 1,
		flexShrink: 0,
		visible: false,
	});
	root.add(header);
	header.add(
		new TextRenderable(renderer, {
			id: "header-title",
			content: new StyledText([
				fg(palette.primary)("◆ "),
				bold(fg(palette.text)("guardian")),
			]),
		}),
	);
	const headerModel = new TextRenderable(renderer, {
		id: "header-model",
		content: session.model,
		fg: palette.textMuted,
	});
	header.add(headerModel);

	// Transcript: the scrollable conversation. Hidden until the first turn.
	// It is the one element allowed to shrink — everything around it is pinned
	// with `flexShrink: 0` so a long reply scrolls instead of crushing the
	// slab, hints and footer.
	const transcript = new ScrollBoxRenderable(renderer, {
		id: "transcript",
		width: TRANSCRIPT_PERCENT,
		flexGrow: 1,
		flexShrink: 1,
		minHeight: 0,
		flexDirection: "column",
		marginTop: 1,
		visible: false,
		// Follow the newest text as a reply streams in; scrolling up to reread
		// releases the pin, and sending the next prompt re-pins it.
		stickyScroll: true,
		stickyStart: "bottom",
	});
	root.add(transcript);

	// The slab: a fill-defined panel with a bright hairline bar on its left
	// edge. No border — `border` stays false so nothing draws box characters.
	// Vertical padding lives on the body so the bar spans the full height.
	const slab = new BoxRenderable(renderer, {
		id: "slab",
		width: PANEL_PERCENT,
		minWidth: PANEL_MIN,
		flexDirection: "row",
		backgroundColor: palette.surface,
		border: false,
		marginTop: 2,
		flexShrink: 0,
	});
	root.add(slab);

	slab.add(
		new BoxRenderable(renderer, {
			id: "slab-bar",
			width: 1,
			alignSelf: "stretch",
			backgroundColor: palette.surfaceBar,
		}),
	);

	const slabBody = new BoxRenderable(renderer, {
		id: "slab-body",
		flexGrow: 1,
		flexDirection: "column",
		paddingLeft: 1,
		paddingTop: 1,
		paddingBottom: 1,
		backgroundColor: palette.surface,
	});
	slab.add(slabBody);

	const input = new InputRenderable(renderer, {
		id: "prompt",
		placeholder: 'Message guardian... "/model" to switch',
		width: "100%",
		backgroundColor: palette.surface,
		focusedBackgroundColor: palette.surface,
		textColor: palette.text,
		placeholderColor: palette.textMuted,
		cursorColor: palette.text,
	});
	slabBody.add(input);

	slabBody.add(
		new BoxRenderable(renderer, {
			id: "slab-gap",
			height: 1,
			backgroundColor: palette.surface,
		}),
	);

	const status = new TextRenderable(renderer, {
		id: "status",
		content: "",
		fg: palette.textFaint,
		bg: palette.surface,
	});
	slabBody.add(status);

	// Hints row, right-aligned to the slab's right edge.
	const hints = new BoxRenderable(renderer, {
		id: "hints",
		width: PANEL_PERCENT,
		minWidth: PANEL_MIN,
		flexDirection: "row",
		justifyContent: "flex-end",
		marginTop: 1,
		flexShrink: 0,
	});
	root.add(hints);
	hints.add(
		new TextRenderable(renderer, {
			id: "hints-text",
			content: hintsText(HINTS),
			wrapMode: "none",
		}),
	);

	const tip = new TextRenderable(renderer, {
		id: "tip",
		content: `\u25cf ${session.provider}`,
		fg: palette.amber,
		marginTop: 1,
		flexShrink: 0,
	});
	root.add(tip);

	const bottomSpacer = new BoxRenderable(renderer, {
		id: "spacer-bottom",
		flexGrow: 64,
		flexShrink: 1,
	});
	root.add(bottomSpacer);

	// Footer: cwd at the far left, version at the far right, full width.
	const footer = new BoxRenderable(renderer, {
		id: "footer",
		width: "100%",
		flexDirection: "row",
		justifyContent: "space-between",
		paddingLeft: 2,
		paddingRight: 2,
		flexShrink: 0,
	});
	root.add(footer);
	footer.add(
		new TextRenderable(renderer, {
			id: "footer-cwd",
			content: homeRelative(process.cwd()),
			fg: palette.textFaint,
		}),
	);
	footer.add(
		new TextRenderable(renderer, {
			id: "footer-version",
			content: version,
			fg: palette.textFaint,
		}),
	);

	// ─── Behavior ────────────────────────────────────────────────────────────

	input.focus();

	const showIdleStatus = () => {
		status.content = `${session.model} · ${session.provider}`;
		status.fg = palette.textFaint;
	};
	showIdleStatus();

	/** Everything that mirrors the active model: tip, header, idle status. */
	const refreshModel = () => {
		tip.content = `● ${session.provider}`;
		headerModel.content = session.model;
		showIdleStatus();
	};

	/**
	 * Swap between the two layouts. Idle is the centered splash (wordmark, roomy
	 * margins); chat trades the wordmark for a one-line header so the
	 * transcript gets every row it can.
	 */
	const setChatLayout = (chat: boolean) => {
		wordmark.visible = !chat;
		topSpacer.visible = !chat;
		bottomSpacer.visible = !chat;
		header.visible = chat;
		transcript.visible = chat;
		slab.marginTop = chat ? 1 : 2;
		tip.marginTop = chat ? 0 : 1;
	};

	// The model picker overlay. Selecting a model routes it straight into the
	// session and refreshes the status/tip lines, exactly like `/model <id>`.
	const picker = createModelPicker(renderer, {
		listModels:
			opts.listModels ??
			(async () => {
				const { listAllModels } = await import("../providers/dynamic-models.ts");
				return listAllModels();
			}),
		onSelect: (modelId) => {
			session.setModel(modelId);
			refreshModel();
			status.content = `model · ${session.model}`;
			status.fg = palette.info;
			input.focus();
		},
	});

	let busy = false;
	/** Monotonic id source for transcript lines — never resets, even on /clear. */
	let lineSeq = 0;

	// ─── Busy spinner ────────────────────────────────────────────────────────
	// A turn can sit silent for seconds before the first token. A moving glyph
	// on the status line says the app is alive, not hung.
	let spinTimer: ReturnType<typeof setInterval> | undefined;
	let spinLabel = "";
	let spinFrame = 0;

	const stopSpinner = () => {
		if (spinTimer) clearInterval(spinTimer);
		spinTimer = undefined;
	};
	const paintSpinner = () => {
		// A quit mid-stream destroys the renderer; a late tick must not touch it.
		if (renderer.isDestroyed) return stopSpinner();
		status.content = `${SPINNER[spinFrame++ % SPINNER.length]} ${session.model} · ${spinLabel}`;
	};
	const startSpinner = (label: string) => {
		stopSpinner();
		spinLabel = label;
		spinFrame = 0;
		status.fg = palette.textMuted;
		paintSpinner();
		spinTimer = setInterval(paintSpinner, 90);
	};
	renderer.on(CliRenderEvents.DESTROY, stopSpinner);

	// ─── Transcript ──────────────────────────────────────────────────────────

	/**
	 * Append one message: a right-aligned role label ("you ›", "anthropic ›")
	 * beside a wrapping body. Separate columns give replies a hanging indent —
	 * wrapped lines stay under the text instead of sliding back under the label.
	 */
	const addMessage = (
		label: string,
		labelColor: string,
		text: string,
		textColor: string,
	): { row: BoxRenderable; label: TextRenderable; body: TextRenderable } => {
		setChatLayout(true);
		const id = lineSeq++;
		const row = new BoxRenderable(renderer, {
			id: `tl-${id}`,
			width: "100%",
			flexDirection: "row",
			flexShrink: 0,
			marginBottom: 1,
		});
		const roleLabel = new TextRenderable(renderer, {
			id: `tl-${id}-label`,
			content: `${label.slice(0, LABEL_WIDTH - 2)} ›`.padStart(LABEL_WIDTH),
			fg: labelColor,
			width: LABEL_WIDTH,
			flexShrink: 0,
			marginRight: 1,
		});
		const body = new TextRenderable(renderer, {
			id: `tl-${id}-body`,
			content: text,
			fg: textColor,
			flexGrow: 1,
			flexShrink: 1,
		});
		row.add(roleLabel);
		row.add(body);
		transcript.add(row);
		scrollTranscriptToBottom();
		return { row, label: roleLabel, body };
	};

	/** Pin the transcript to its latest line. */
	const scrollTranscriptToBottom = () => {
		transcript.scrollTo({ x: 0, y: transcript.scrollHeight });
	};

	/** Handle a slash command. Returns true if the text was one. */
	const runCommand = (text: string): boolean => {
		const cmd = parseCommand(text);
		if (!cmd) return false;

		if (cmd.name === "/models") {
			// Open the picker overlay; it takes over key handling until the
			// user selects a model or presses Escape.
			input.blur();
			picker.open();
			return true;
		}

		if (cmd.name === "/model") {
			if (!cmd.arg) {
				status.content = `current model · ${session.model}`;
				status.fg = palette.info;
				return true;
			}
			session.setModel(cmd.arg);
			refreshModel();
			status.content = `model · ${session.model}`;
			status.fg = palette.info;
			return true;
		}

		if (cmd.name === "/clear") {
			session.clear();
			// `getChildren()` is a live view on some renderers, so snapshot before
			// removing — iterating while mutating would skip children.
			for (const child of [...transcript.getChildren()]) {
				transcript.remove(child);
			}
			setChatLayout(false);
			showIdleStatus();
			status.content = "conversation cleared";
			status.fg = palette.info;
			return true;
		}

		status.content = `unknown command ${cmd.name} — /models, /model, /clear`;
		status.fg = palette.warning;
		return true;
	};

	/** Send a prompt through the pipeline and stream the reply. */
	const submit = async (): Promise<void> => {
		const text = input.value.trim();
		if (!text || busy) return;

		if (runCommand(text)) {
			input.value = "";
			return;
		}

		busy = true;
		input.value = "";
		headerModel.content = session.model;
		addMessage("you", palette.primary, text, palette.text);

		// The assistant's reply row is created up front and filled in as chunks
		// stream, so the user sees tokens arrive.
		const reply = addMessage(session.provider, palette.secondary, "", palette.text);
		startSpinner("sending…");

		try {
			const stream = session.send(text);
			let step = await stream.next();
			let accumulated = "";
			while (!step.done) {
				if (!accumulated) spinLabel = "streaming…";
				accumulated += step.value;
				reply.body.content = accumulated;
				scrollTranscriptToBottom();
				step = await stream.next();
			}
			const metrics: TurnMetrics = step.value;
			stopSpinner();
			status.content = summarizeTurn(metrics);
			status.fg = palette.success;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			stopSpinner();
			reply.label.fg = palette.error;
			reply.body.content = `error: ${msg}`;
			reply.body.fg = palette.error;
			status.content = msg.slice(0, 60);
			status.fg = palette.error;
		} finally {
			stopSpinner();
			scrollTranscriptToBottom();
			busy = false;
		}
	};

	input.on(InputRenderableEvents.ENTER, () => {
		void submit();
	});

	return {
		input,
		status,
		tip,
		slab,
		wordmark,
		header,
		transcript,
		session,
		picker,
		submit,
	};
}

/**
 * Mount and run the interactive TUI. Resolves when the user exits, so the
 * caller can `await` it and let the process end naturally.
 */
export async function runTui(opts: TuiOptions): Promise<void> {
	const renderer: CliRenderer = await createCliRenderer({
		exitOnCtrlC: false,
		screenMode: "alternate-screen",
		backgroundColor: palette.background,
		targetFps: 30,
	});

	mountTui(renderer, opts);

	await new Promise<void>((resolve) => {
		let done = false;
		const shutdown = () => {
			if (done) return;
			done = true;
			renderer.destroy();
			resolve();
		};

		renderer.keyInput.on("keypress", (key: KeyEvent) => {
			// The model picker consumes Escape to close itself and calls
			// preventDefault(); honor that so Escape closes the picker instead
			// of quitting the whole TUI. Ctrl+C is never consumed by the
			// picker, so it still quits here.
			if (key.defaultPrevented) return;
			if (isQuitKey(key)) shutdown();
		});

		// A signal from outside (kill, terminal close, parent exiting) must also
		// tear the renderer down — otherwise the alternate screen is never
		// exited and the user's shell is left with a garbled viewport.
		process.once("SIGINT", shutdown);
		process.once("SIGTERM", shutdown);
		process.once("SIGHUP", shutdown);
	});
}
