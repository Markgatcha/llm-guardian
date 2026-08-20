// Model picker overlay for the guardian TUI.
//
// Mounted on demand (the `/models` command) as an absolutely-positioned panel
// that floats above the transcript. It lists every model Guardian can route to
// — the static fingerprint catalog merged with the live OpenRouter catalog via
// `listAllModels()` — and lets the user narrow the list by typing, move with
// the arrow keys, and commit with Enter. Selecting a model hands its id back to
// the chat session through a callback; Escape dismisses the picker without
// changing anything.
//
// Why a dedicated module instead of inlining in ./tui.ts
// ------------------------------------------------------
// The picker owns its own key handling, its own focus lifecycle, and an async
// model fetch. Keeping it separate means ./tui.ts stays a thin layout/behavior
// wiring file, and the picker can be exercised headlessly by the test renderer
// with an injected (offline) model source — no network, no flakiness.
//
// Key-handling contract
// ---------------------
// The picker listens on `renderer.keyInput` directly rather than taking DOM
// focus. This sidesteps a focus fight with the main prompt input: when the
// picker opens we blur the prompt, and while the picker is open it consumes
// every relevant key. Escape calls `preventDefault()` on the KeyEvent so the
// TUI's quit listener (which also treats Escape as "exit") can see the event
// was already handled and skip quitting. Ctrl+C is deliberately NOT consumed,
// so it still quits the whole TUI even while the picker is open.

import {
	BoxRenderable,
	type CliRenderer,
	type KeyEvent,
	SelectRenderable,
	SelectRenderableEvents,
	TextRenderable,
} from "@opentui/core";
import { palette } from "./theme.ts";

/** One row in the picker. Mirrors the shape `listAllModels()` returns. */
export interface ModelListing {
	/** Full model id, e.g. "anthropic/claude-sonnet-4-5". */
	id: string;
	/** Human-readable name. */
	name: string;
	/** Provider prefix, e.g. "anthropic", "openai", "google". */
	provider: string;
	/** Input cost per 1M tokens (USD). */
	inputCostPerMillion: number;
	/** Output cost per 1M tokens (USD). */
	outputCostPerMillion: number;
	/** Context window in tokens. */
	contextWindow: number;
	/** Whether the model supports tool use. */
	supportsTools: boolean;
}

export type ModelPickerOptions = {
	/** Version-free model source. Tests inject a static list here. */
	listModels: () => Promise<ModelListing[]>;
	/** Called with the chosen model id when the user commits a selection. */
	onSelect: (modelId: string) => void;
	/**
	 * Optional cap on rows shown at once. Defaults to 12 — enough to scroll on
	 * a normal terminal without overwhelming a small one.
	 */
	maxVisible?: number;
};

/** Handles onto the picker so the TUI (and tests) can drive and inspect it. */
export type ModelPickerHandles = {
	/** Whether the picker is currently mounted and consuming keys. */
	isOpen: () => boolean;
	/** Mount the overlay, blur the prompt, and start loading models. */
	open: () => void;
	/** Unmount the overlay and signal that the prompt should be refocused. */
	close: () => void;
	/** The current filter string (what the user has typed). */
	filter: () => string;
	/** The full, unfiltered model list once loaded. */
	models: () => ModelListing[];
	/** The rows currently visible after filtering. */
	visibleModels: () => ModelListing[];
	/** The underlying select — tests assert on its selectedIndex/options. */
	select: SelectRenderable;
};

/** Format a per-million cost as a compact "$x.xx/M" string. */
function formatCost(perMillion: number): string {
	if (perMillion <= 0) return "free";
	if (perMillion < 0.01) return "$<0.01/M";
	return `$${perMillion.toFixed(2)}/M`;
}

/** Format a context window as "128k" / "1M" style. */
function formatContext(tokens: number): string {
	if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
	if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
	return `${tokens}`;
}

/** True when a model matches the filter on id, name, or provider. */
function matches(model: ModelListing, filter: string): boolean {
	if (!filter) return true;
	const needle = filter.toLowerCase();
	return (
		model.id.toLowerCase().includes(needle) ||
		model.name.toLowerCase().includes(needle) ||
		model.provider.toLowerCase().includes(needle)
	);
}

/**
 * Build the picker into an existing renderer and wire up its behavior.
 *
 * The picker is created in a CLOSED state — nothing is mounted until `open()`
 * is called. This lets `mountTui` construct it eagerly and hand the `/models`
 * command a stable handle without paying any layout cost up front.
 */
export function createModelPicker(
	renderer: CliRenderer,
	opts: ModelPickerOptions,
): ModelPickerHandles {
	const { listModels, onSelect } = opts;

	let open = false;
	let filterText = "";
	let allModels: ModelListing[] = [];
	let loaded = false;
	/**
	 * The highlighted row index. Tracked locally because `SelectRenderable`
	 * exposes a `selectedIndex` SETTER but no getter — reading it back yields
	 * `undefined`. We push every change into the select for rendering, but
	 * this variable is the source of truth for navigation and selection.
	 */
	let selectedIdx = 0;

	// ─── Overlay container ───────────────────────────────────────────────────
	// Absolutely positioned so it floats above the transcript. Sized as a
	// centered panel: 72% wide, starting 8% down, 78% tall. Added to the root
	// LAST so it paints on top of everything else in the tree.
	const overlay = new BoxRenderable(renderer, {
		id: "model-picker",
		position: "absolute",
		left: "14%",
		top: "8%",
		width: "72%",
		height: "78%",
		flexDirection: "column",
		backgroundColor: palette.surface,
		paddingLeft: 2,
		paddingRight: 2,
		paddingTop: 1,
		paddingBottom: 1,
		visible: false,
	});

	// Header: title on the left, live filter echo on the right.
	const header = new BoxRenderable(renderer, {
		id: "model-picker-header",
		width: "100%",
		flexDirection: "row",
		justifyContent: "space-between",
	});
	overlay.add(header);
	header.add(
		new TextRenderable(renderer, {
			id: "model-picker-title",
			content: "select a model",
			fg: palette.primary,
		}),
	);
	const filterEcho = new TextRenderable(renderer, {
		id: "model-picker-filter",
		content: "",
		fg: palette.textMuted,
	});
	header.add(filterEcho);

	// The scrollable, selectable list. Driven manually via `selectedIndex` —
	// we never focus it, so the picker keeps full control of key routing.
	const select = new SelectRenderable(renderer, {
		id: "model-picker-list",
		flexGrow: 1,
		width: "100%",
		backgroundColor: palette.surface,
		textColor: palette.text,
		focusedBackgroundColor: palette.surface,
		focusedTextColor: palette.text,
		selectedBackgroundColor: palette.surfaceBar,
		selectedTextColor: palette.background,
		descriptionColor: palette.textFaint,
		selectedDescriptionColor: palette.background,
		showDescription: true,
		showScrollIndicator: true,
		wrapSelection: true,
		options: [],
	});
	overlay.add(select);

	// Footer: key hints.
	const footer = new TextRenderable(renderer, {
		id: "model-picker-footer",
		content:
			"type to filter   \u2191\u2193 move   enter select   esc close",
		fg: palette.textFaint,
	});
	overlay.add(footer);

	// ─── Rendering the list ──────────────────────────────────────────────────

	/** Rebuild the select's options from the current filter. */
	const refreshOptions = () => {
		const rows = allModels.filter((m) => matches(m, filterText));
		select.options = rows.map((m) => ({
			name: m.id,
			description: `${m.provider} \u00b7 ${formatContext(m.contextWindow)} ctx \u00b7 ${formatCost(m.inputCostPerMillion)} in`,
			value: m.id,
		}));
		// Keep the highlight in bounds after the list shrinks/grows. Track it
		// locally (the select has no selectedIndex getter) and mirror to the
		// select for rendering.
		selectedIdx = 0;
		select.selectedIndex = selectedIdx;
	};

	/** Show the loading / empty / count state in the filter echo line. */
	const refreshEcho = () => {
		if (!loaded) {
			filterEcho.content = "loading models\u2026";
			return;
		}
		const visible = allModels.filter((m) => matches(m, filterText)).length;
		filterEcho.content = filterText
			? `"${filterText}" \u00b7 ${visible}/${allModels.length}`
			: `${allModels.length} models`;
	};

	// ─── Key handling ────────────────────────────────────────────────────────

	const onKeyPress = (key: KeyEvent) => {
		if (!open) return;

		// Ctrl+C always quits the whole TUI — never swallow it.
		if (key.ctrl && key.name === "c") return;

		if (key.name === "escape") {
			// Consumed: the TUI's quit listener checks defaultPrevented and
			// will skip quitting because the picker handled it.
			key.preventDefault();
			close();
			return;
		}

		if (key.name === "up") {
			key.preventDefault();
			const n = select.options.length;
			if (n > 0) {
				selectedIdx = (selectedIdx - 1 + n) % n;
				select.selectedIndex = selectedIdx;
			}
			return;
		}
		if (key.name === "down") {
			key.preventDefault();
			const n = select.options.length;
			if (n > 0) {
				selectedIdx = (selectedIdx + 1) % n;
				select.selectedIndex = selectedIdx;
			}
			return;
		}

		if (key.name === "return" || key.name === "enter") {
			key.preventDefault();
			const rows = allModels.filter((m) => matches(m, filterText));
			const chosen = rows[selectedIdx];
			if (chosen) {
				const id = chosen.id;
				close();
				onSelect(id);
			}
			return;
		}

		if (key.name === "backspace") {
			key.preventDefault();
			filterText = filterText.slice(0, -1);
			refreshOptions();
			refreshEcho();
			return;
		}

		// Printable character: extend the filter. `sequence` carries the raw
		// glyph; guard against control sequences leaking in.
		if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
			key.preventDefault();
			filterText += key.sequence;
			refreshOptions();
			refreshEcho();
		}
	};

	// Belt-and-suspenders: if the select fires its own ITEM_SELECTED (e.g. a
	// mouse click on a focused list), honor it the same way Enter does.
	select.on(SelectRenderableEvents.ITEM_SELECTED, (option: { value?: unknown }) => {
		if (!open) return;
		const id = typeof option?.value === "string" ? option.value : undefined;
		if (id) {
			close();
			onSelect(id);
		}
	});

	// ─── Lifecycle ───────────────────────────────────────────────────────────

	const openPicker = () => {
		if (open) return;
		open = true;
		filterText = "";
		selectedIdx = 0;
		overlay.visible = true;
		renderer.root.add(overlay);
		// Prepend so this handler runs BEFORE any listener registered earlier
		// (notably the TUI's quit listener in runTui). That lets us preventDefault
		// on Escape so the quit listener — which checks defaultPrevented — skips
		// quitting and the picker closes instead.
		renderer.keyInput.prependListener("keypress", onKeyPress);
		refreshEcho();

		// Kick off the fetch once; subsequent opens reuse the cached list.
		if (!loaded) {
			void listModels()
				.then((models) => {
					allModels = models;
					loaded = true;
					if (open) {
						refreshOptions();
						refreshEcho();
					}
				})
				.catch(() => {
					// Network failure — listAllModels already falls back to the
					// static catalog, so an empty result here just means "nothing
					// to show." Surface it in the echo line rather than crashing.
					loaded = true;
					if (open) refreshEcho();
				});
		} else {
			refreshOptions();
		}
	};

	const close = () => {
		if (!open) return;
		open = false;
		overlay.visible = false;
		renderer.keyInput.off("keypress", onKeyPress);
		renderer.root.remove(overlay);
	};

	return {
		isOpen: () => open,
		open: openPicker,
		close,
		filter: () => filterText,
		models: () => allModels,
		visibleModels: () => allModels.filter((m) => matches(m, filterText)),
		select,
	};
}
