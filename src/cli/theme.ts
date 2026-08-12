// CLI design tokens for the guardian terminal interface.
//
// A modern, minimal color system built on a twelve-step grayscale ramp with
// a warm peach primary, blue secondary, and purple accent. Colors resolve to
// ANSI truecolor escapes, with automatic dark/light selection and graceful
// degradation for piped output.
//
// Design notes:
//   - The step ramp runs 1 (background) → 12 (foreground). Steps 9/10 are the
//     brand accents; step 11 is muted text; step 12 is body text.
//   - Dark/light selection follows COLORFGBG (most reliable), then the
//     GUARDIAN_THEME override, defaulting to dark.
//   - NO_COLOR (https://no-color.org/) and non-TTY output disable styling so
//     piped/CI output stays clean.
//   - Typography-led, never box-led: muted labels, a single accent glyph,
//     thin rules, and generous whitespace. No box-drawing banners.

// ─── Raw palette ─────────────────────────────────────────────────────────────

const DARK = {
	step1: "#0a0a0a",
	step2: "#141414",
	step3: "#1e1e1e",
	step4: "#282828",
	step5: "#323232",
	step6: "#3c3c3c",
	step7: "#484848",
	step8: "#606060",
	step9: "#fab283", // primary — warm peach
	step10: "#ffc09f",
	step11: "#808080", // textMuted
	step12: "#eeeeee", // text
	secondary: "#5c9cf5", // blue
	accent: "#9d7cd8", // purple
	red: "#e06c75",
	orange: "#f5a742",
	green: "#7fd88f",
	cyan: "#56b6c2",
	yellow: "#e5c07b",
	// Splash surface tokens — a raised slab one step lighter than the page,
	// with a bright hairline bar pinned to its left edge.
	surface: "#23262b", // input panel fill
	surfaceBar: "#d8d8dc", // panel left accent bar
	amber: "#f5a742", // tip bullet + label
} as const;

const LIGHT = {
	step1: "#ffffff",
	step2: "#fafafa",
	step3: "#f5f5f5",
	step4: "#ebebeb",
	step5: "#e1e1e1",
	step6: "#d4d4d4",
	step7: "#b8b8b8",
	step8: "#a0a0a0",
	step9: "#3b7dd8", // primary — blue on light
	step10: "#2968c3",
	step11: "#8a8a8a", // textMuted
	step12: "#1a1a1a", // text
	secondary: "#7b5bb6", // purple
	accent: "#d68c27", // amber
	red: "#d1383d",
	orange: "#d68c27",
	green: "#3d9a57",
	cyan: "#318795",
	yellow: "#b0851f",
	// Splash surface tokens — on light the slab goes one step DARKER than the
	// page (a recessed well) and the accent bar goes dark for contrast.
	surface: "#ebebeb", // input panel fill
	surfaceBar: "#3a3a3a", // panel left accent bar
	amber: "#b06a00", // tip bullet + label (readable on white)
} as const;

// ─── Mode + capability detection ─────────────────────────────────────────────

type Mode = "dark" | "light";

function detectMode(): Mode {
	const forced = (process.env.GUARDIAN_THEME || "").toLowerCase();
	if (forced === "light" || forced === "dark") return forced;

	// COLORFGBG is set by most modern terminals: "<fg>;<bg>", bg 0–6/8 = dark.
	const cfgbg = process.env.COLORFGBG;
	if (cfgbg) {
		const parts = cfgbg.split(";").map((p) => parseInt(p, 10));
		const bg = parts[parts.length - 1];
		if (!Number.isNaN(bg)) {
			return bg === 7 || bg === 15 || bg >= 9 ? "light" : "dark";
		}
	}

	return "dark";
}

function colorSupported(): boolean {
	if (process.env.NO_COLOR !== undefined) return false;
	if (process.env.TERM === "dumb") return false;
	if (!process.stdout.isTTY) return false;
	return true;
}

const MODE: Mode = detectMode();
const ENABLED = colorSupported();
const P = MODE === "dark" ? DARK : LIGHT;

// ─── Truecolor escape helpers ────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
	const h = hex.replace("#", "");
	return [
		parseInt(h.slice(0, 2), 16),
		parseInt(h.slice(2, 4), 16),
		parseInt(h.slice(4, 6), 16),
	];
}

function fg(hex: string, text: string): string {
	if (!ENABLED) return text;
	const [r, g, b] = hexToRgb(hex);
	return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
}

/**
 * Paint a background behind `text`. Used only by the splash slab — the raised
 * input panel is defined by a fill change, never by box-drawing characters.
 */
function bg(hex: string, text: string): string {
	if (!ENABLED) return text;
	const [r, g, b] = hexToRgb(hex);
	return `\x1b[48;2;${r};${g};${b}m${text}\x1b[0m`;
}

/**
 * Paint foreground and background in a single escape pair so the slab's
 * interior text keeps the panel fill behind it.
 */
function fgOn(fgHex: string, bgHex: string, text: string): string {
	if (!ENABLED) return text;
	const [fr, fgc, fb] = hexToRgb(fgHex);
	const [br, bgc, bb] = hexToRgb(bgHex);
	return `\x1b[38;2;${fr};${fgc};${fb};48;2;${br};${bgc};${bb}m${text}\x1b[0m`;
}

/**
 * Linear interpolation between two hex colors. Powers the wordmark's
 * left-to-right brightness ramp: dim at the first letter, near-white at the
 * last, computed at runtime so both themes get a correct ramp.
 */
function mixHex(fromHex: string, toHex: string, t: number): string {
	const a = hexToRgb(fromHex);
	const b = hexToRgb(toHex);
	const clamped = Math.max(0, Math.min(1, t));
	const ch = (i: 0 | 1 | 2) =>
		Math.round(a[i] + (b[i] - a[i]) * clamped)
			.toString(16)
			.padStart(2, "0");
	return `#${ch(0)}${ch(1)}${ch(2)}`;
}

function bold(text: string): string {
	return ENABLED ? `[1m${text}[0m` : text;
}

function dim(text: string): string {
	return ENABLED ? `[2m${text}[0m` : text;
}

// ─── Semantic token API ─────────────────────────────────────────────────────

export const theme = {
	/** Brand primary — headings, the accent glyph, key values. */
	primary: (t: string) => fg(P.step9, t),
	/** Secondary — supporting accent. */
	secondary: (t: string) => fg(P.secondary, t),
	/** Accent — highlight color. */
	accent: (t: string) => fg(P.accent, t),
	/** Body text. */
	text: (t: string) => fg(P.step12, t),
	/** De-emphasized text — labels, hints, timestamps. */
	textMuted: (t: string) => fg(P.step11, t),
	/** Success state (green). */
	success: (t: string) => fg(P.green, t),
	/** Warning state (orange). */
	warning: (t: string) => fg(P.orange, t),
	/** Error state (red). */
	error: (t: string) => fg(P.red, t),
	/** Informational accent (cyan). */
	info: (t: string) => fg(P.cyan, t),
	/** Emphasis without color. */
	bold,
	dim,
	/** Thin separator color (used only for rules, never boxes). */
	rule: (t: string) => fg(P.step6, t),

	// ─── Splash surface tokens ─────────────────────────────────────────────
	/** The raised slab fill — paints the input panel band. */
	surface: (t: string) => bg(P.surface, t),
	/** Body text sitting on the slab (keeps the panel fill behind it). */
	onSurface: (t: string) => fgOn(P.step12, P.surface, t),
	/** Muted placeholder text on the slab. */
	onSurfaceMuted: (t: string) => fgOn(P.step11, P.surface, t),
	/** Dimmest tier on the slab — provider names, trailing metadata. */
	onSurfaceFaint: (t: string) => fgOn(P.step8, P.surface, t),
	/** The bright hairline bar pinned to the slab's left edge. */
	surfaceBar: (t: string) => fgOn(P.surfaceBar, P.surface, t),
	/** Inverted block cursor sitting in the placeholder. */
	cursor: (t: string) => fgOn(P.surface, P.step12, t),
	/** Amber tip accent — the single warm highlight on the splash. */
	tip: (t: string) => fg(P.amber, t),

	/**
	 * Wordmark ramp: `t` runs 0 (leftmost glyph column) → 1 (rightmost),
	 * interpolating from a dim step to near-foreground so the logo brightens
	 * left-to-right.
	 */
	wordmark: (t: string, position: number) =>
		fg(mixHex(P.step7, P.step12, position), t),
} as const;

export const colorEnabled = ENABLED;
export const themeMode = MODE;

/**
 * The resolved raw hex values for the active mode.
 *
 * The `theme` API above returns ANSI-wrapped strings, which is right for
 * `console.log` output but wrong for a renderer that wants to own its own
 * escape emission. The TUI layer composes cells from these hex values instead,
 * so both paths draw from one palette and can never drift apart.
 */
export const palette = {
	/** Page background. */
	background: P.step1,
	/** Raised slab fill. */
	surface: P.surface,
	/** Bright hairline bar on the slab's left edge. */
	surfaceBar: P.surfaceBar,
	/** Body text. */
	text: P.step12,
	/** De-emphasized text — labels, hints, placeholders. */
	textMuted: P.step11,
	/** Dimmest tier — provider names, trailing metadata. */
	textFaint: P.step8,
	/** Brand primary. */
	primary: P.step9,
	secondary: P.secondary,
	accent: P.accent,
	/** The single warm highlight, used by the tip line. */
	amber: P.amber,
	success: P.green,
	warning: P.orange,
	error: P.red,
	info: P.cyan,
	/** Thin separator color. */
	rule: P.step6,
	/** Both ends of the wordmark's brightness ramp. */
	wordmarkFrom: P.step7,
	wordmarkTo: P.step12,
} as const;

/**
 * Interpolate between two hex colors — exported so the TUI can build the
 * wordmark's per-column ramp with the same math the ANSI path uses.
 */
export const mix = mixHex;
