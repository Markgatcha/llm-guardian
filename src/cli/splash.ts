// Splash screen for the guardian CLI.
//
// This is the screen you get from a bare `guardian` invocation. It composes
// the splash grammar from ./ui.ts (wordmark rasterizer, slab rows, tier
// painting, viewport geometry) into a full-viewport, vertically balanced start
// state built from four stacked elements:
//
//   1. a blocky half-block wordmark with a left-to-right brightness ramp
//   2. a raised slab — no borders, just a fill change — holding the prompt
//      line and a status line, with a bright hairline bar on its left edge
//   3. right-aligned keybinding hints, flush with the slab's right edge
//   4. a centered amber tip, and a bottom-anchored footer (cwd / version)
//
// Layout is grid-exact rather than eyeballed. Everything is measured in
// terminal cells and rows so the composition holds at any window size:
//
//   rows 0..T-1     blank top padding (~36% of the viewport)
//   rows T..T+2     wordmark            (3 rows, 6 pixel rows via half blocks)
//   rows T+3..T+4   blank
//   rows T+5..T+9   slab                (pad / prompt / blank / status / pad)
//   row  T+10       blank
//   row  T+11       keybinding hints    (right-aligned to the slab)
//   rows T+12..T+14 blank
//   row  T+15       tip line            (centered)
//   …               blank filler
//   last row - 1    footer              (cwd left, version right)
//
// Color is delegated entirely to ./theme.ts, so the whole screen degrades to
// clean, aligned plain text under NO_COLOR, in CI, or when piped.

import { theme } from "./theme.ts";
import {
	type Segment,
	columns,
	homeRelative,
	panelLeft,
	panelWidth,
	renderWordmark,
	rows,
	slabRow,
} from "./ui.ts";

/** Fraction of the viewport height above the wordmark. */
const TOP_RATIO = 0.36;

/** Default keybinding hints shown under the slab. */
const HINTS: readonly (readonly [string, string])[] = [
	["enter", "optimize"],
	["ctrl+p", "commands"],
];

export type SplashOptions = {
	/** Active mode label shown first on the status line. */
	mode?: string;
	/** Selected model. */
	model?: string;
	/** Provider backing that model, shown dimmest. */
	provider?: string;
	/** Version string for the bottom-right footer. */
	version?: string;
	/** Placeholder shown on the prompt line. */
	placeholder?: string;
	/** Example text quoted after the placeholder. */
	example?: string;
	/** The amber tip's actionable command. */
	tipCommand?: string;
	/** The amber tip's trailing prose. */
	tipText?: string;
	/** Keybinding hints: `[key, action]` pairs, left to right. */
	hints?: readonly (readonly [string, string])[];
	/**
	 * Viewport override in cells. Defaults to the live terminal size; passing
	 * it explicitly makes the composition deterministic for tests and for
	 * rendering to a fixed-size target.
	 */
	viewport?: { cols: number; rows: number };
};

/**
 * Compose the splash into an array of terminal rows.
 *
 * Split out from the printer so tests and verification scripts can assert on
 * the geometry (row count, centering, slab alignment) without capturing
 * stdout.
 */
export function composeSplash(opts: SplashOptions = {}): string[] {
	const {
		mode = "Optimize",
		model = "auto",
		provider = "OpenRouter",
		version = "0.0.0",
		placeholder = "Optimize anything... ",
		example = '"Fold this prompt"',
		tipCommand = "guardian start",
		tipText = "to launch the gateway and start saving tokens",
		hints = HINTS,
		viewport,
	} = opts;

	const cols = viewport?.cols ?? columns();
	const height = viewport?.rows ?? rows();
	const width = panelWidth(cols);
	const left = panelLeft(cols);
	const indent = " ".repeat(left);

	const out: string[] = [];

	// 1. Wordmark, centered on the viewport (not on the slab).
	const mark = renderWordmark("guardian");
	const markIndent = " ".repeat(Math.max(0, Math.floor((cols - mark.width) / 2)));

	for (let i = 0; i < Math.max(1, Math.round(height * TOP_RATIO)); i++) {
		out.push("");
	}
	for (const row of mark.rows) out.push(markIndent + row);

	// 2. Two blank rows, then the slab: pad / prompt / blank / status / pad.
	out.push("", "");

	const pad = indent + slabRow([], width);
	out.push(pad);

	// Prompt line: a block cursor sits on the first character, the placeholder
	// is muted, and the quoted example is one tier brighter.
	const promptRow: Segment[] = [
		[placeholder.charAt(0) || " ", "cursor"],
		[placeholder.slice(1), "muted"],
		[example, "text"],
	];
	out.push(indent + slabRow(promptRow, width));

	out.push(pad);

	// Status line: mode (brightest) · model, then the provider dimmest.
	const statusRow: Segment[] = [
		[mode, "bold"],
		[" \u00b7 ", "faint"],
		[model, "text"],
		["  ", "faint"],
		[provider, "faint"],
	];
	out.push(indent + slabRow(statusRow, width));

	out.push(pad);

	// 3. Keybinding hints, right-aligned flush with the slab's right edge.
	out.push("");
	const hintPlain = hints.map(([k, a]) => `${k} ${a}`).join("   ");
	const hintPainted = hints
		.map(([k, a]) => `${theme.bold(theme.text(k))} ${theme.textMuted(a)}`)
		.join("   ");
	out.push(" ".repeat(Math.max(0, left + width - hintPlain.length)) + hintPainted);

	// 4. Three blank rows, then the centered amber tip.
	out.push("", "", "");
	const tipPlain = `\u25cf Tip Run ${tipCommand} ${tipText}`;
	const tipPainted =
		`${theme.tip("\u25cf")} ${theme.tip("Tip")} ` +
		`${theme.textMuted("Run")} ${theme.bold(theme.text(tipCommand))} ` +
		`${theme.textMuted(tipText)}`;
	out.push(
		" ".repeat(Math.max(0, Math.floor((cols - tipPlain.length) / 2))) + tipPainted,
	);

	// Footer, bottom-anchored with one row of breathing room beneath it.
	// The gap is computed BEFORE the loop: `out.length` grows on every push,
	// so testing it inside the condition would fill only half the gap.
	const cwd = homeRelative(process.cwd());
	const gap = Math.max(0, height - out.length - 2);
	for (let i = 0; i < gap; i++) out.push("");
	const fill = Math.max(1, cols - 4 - cwd.length - version.length);
	out.push(
		`  ${theme.textMuted(cwd)}${" ".repeat(fill)}${theme.textMuted(version)}`,
	);

	return out;
}

/**
 * Render the full-viewport splash to stdout.
 *
 * On a real terminal the screen is cleared first and the cursor homed, so the
 * composition sits centered in the viewport instead of scrolling in from the
 * bottom. When output is piped or redirected the clear is skipped, leaving
 * plain rows that a log or a snapshot test can consume.
 *
 * Nothing here reads input or blocks; callers own what happens next. The whole
 * screen is written in one `process.stdout.write` so it paints without tearing.
 */
export function renderSplash(opts: SplashOptions = {}): void {
	const clear = process.stdout.isTTY ? "\x1b[2J\x1b[H" : "";
	process.stdout.write(`${clear}${composeSplash(opts).join("\n")}\n`);
}
