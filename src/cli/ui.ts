// CLI output primitives for LLM-Guardian.
//
// The guardian terminal interface is typography-led rather than box-led. Two
// grammars live here and share one set of tokens:
//
//   Inline grammar (used inside command output)
//     muted labels on the left, values on the right, thin muted rules to
//     separate sections, a single accent glyph, generous whitespace.
//
//   Splash grammar (used by the start screen and startup banners)
//     a blocky half-block wordmark with a left-to-right brightness ramp; a
//     raised slab defined purely by a fill change (never box-drawing) with a
//     bright hairline bar on its left edge; right-aligned keybinding hints;
//     and a single amber tip line.
//
// The splash grammar's building blocks — `renderWordmark`, `slabRow`, and the
// `panelWidth`/`panelLeft` geometry — are exported so `./splash.ts` composes
// the full-viewport screen from exactly the same primitives the inline
// banners use. One implementation, two densities.
//
// Every primitive degrades to plain text when color is unavailable (piped
// output, CI, NO_COLOR), so logs stay parseable.

import { theme } from "./theme.ts";

// ─── Glyphs ──────────────────────────────────────────────────────────────────

const GLYPH = {
	brand: "◆", // section / brand accent
	step: "›", // a step or active item
	bullet: "•", // list item
	ok: "✓", // success
	warn: "▲", // warning
	err: "✗", // error
	tip: "●", // the amber tip bullet
	bar: "▎", // the slab's left hairline bar
} as const;

// ─── Layout constants ────────────────────────────────────────────────────────

/** Column width for right-aligned muted labels in key/value blocks. */
const LABEL_WIDTH = 18;

/** The slab spans this fraction of the viewport, centered. */
const PANEL_RATIO = 0.47;

/** Never render a slab narrower than this, however small the window. */
const PANEL_MIN = 46;

function padLabel(label: string): string {
	return label.length >= LABEL_WIDTH
		? label
		: label + " ".repeat(LABEL_WIDTH - label.length);
}

/** Current terminal width, with a sane fallback for non-TTY output. */
export function columns(): number {
	return process.stdout.columns || 100;
}

/** Current terminal height, with a sane fallback for non-TTY output. */
export function rows(): number {
	return process.stdout.rows || 40;
}

/** Slab width in cells for the current viewport. */
export function panelWidth(cols = columns()): number {
	return Math.max(PANEL_MIN, Math.min(cols - 4, Math.round(cols * PANEL_RATIO)));
}

/** Left offset in cells that centers the slab in the current viewport. */
export function panelLeft(cols = columns()): number {
	return Math.max(0, Math.floor((cols - panelWidth(cols)) / 2));
}

// ─── Wordmark rasterizer ────────────────────────────────────────────────────

// A 6-pixel-tall bitmap per glyph. Six pixel rows pack into three terminal
// rows using upper/lower half blocks, which is what gives the wordmark its
// chunky low-resolution look without shipping a font.
//
// '#' = ink, '.' = empty. The rows are divided typographically:
//
//   rows 0–4     the letter band — every glyph fills this, baseline on row 4
//   row 5        descender zone — only tailed letters (g, p, q, y, j) use it
//
// Letterforms are small caps: at six pixels of vertical resolution, true
// lowercase bowls collapse into mush, whereas uniform-height caps stay crisp
// and give the mark a flat top and bottom edge. The fold pairs rows (0,1)
// (2,3) (4,5), so a blank row 5 renders the baseline as a clean upper-half
// block and a descender hangs below it as a lower-half block.
//
// Glyphs may be different widths — each entry's rows only have to agree with
// each other. Narrow letters like `i` and `l` stay narrow instead of floating
// in five cells of whitespace.
const BITMAP: Record<string, readonly string[]> = {
	a: [".###.", "#...#", "#####", "#...#", "#...#", "....."],
	c: [".####", "#....", "#....", "#....", ".####", "....."],
	d: ["####.", "#...#", "#...#", "#...#", "####.", "....."],
	e: ["#####", "#....", "####.", "#....", "#####", "....."],
	g: [".###.", "#....", "#.###", "#...#", ".###.", "....."],
	i: ["#", "#", "#", "#", "#", "."],
	l: ["#....", "#....", "#....", "#....", "#####", "....."],
	m: ["#...#", "##.##", "#.#.#", "#...#", "#...#", "....."],
	n: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "....."],
	o: [".###.", "#...#", "#...#", "#...#", ".###.", "....."],
	p: ["####.", "#...#", "####.", "#....", "#....", "#...."],
	r: ["####.", "#...#", "####.", "#..#.", "#...#", "....."],
	s: [".####", "#....", ".###.", "....#", "####.", "....."],
	t: ["#####", "..#..", "..#..", "..#..", "..#..", "....."],
	u: ["#...#", "#...#", "#...#", "#...#", ".###.", "....."],
	" ": ["..", "..", "..", "..", "..", ".."],
};

/** Columns of blank space inserted between glyphs. */
const GLYPH_GAP = 1;

/** Half-block characters, keyed by which pixel halves are inked. */
const HALF = {
	both: "\u2588", // █
	top: "\u2580", // ▀
	bottom: "\u2584", // ▄
	none: " ",
} as const;

/**
 * Rasterize a word into three rows of PLAIN half-block glyphs — no color.
 *
 * This is the shared source of truth for the wordmark. Two consumers paint it
 * differently: `renderWordmark` wraps each cell in ANSI escapes for the
 * `console.log` path, and the TUI builds per-cell StyledText chunks from the
 * same rows. Keeping the geometry here means the two can never diverge.
 */
export function rasterizeWordmark(word: string): {
	rows: string[];
	width: number;
} {
	const letters = [...word.toLowerCase()].map(
		(ch) => BITMAP[ch] ?? BITMAP[" "],
	);

	// Stitch the per-glyph bitmaps into six full-width pixel rows. Glyphs are
	// variable width, so the gap is joined per row rather than assumed.
	const gap = ".".repeat(GLYPH_GAP);
	const pixelRows: string[] = [];
	for (let py = 0; py < 6; py++) {
		pixelRows.push(letters.map((g) => g[py] ?? "").join(gap));
	}
	const width = Math.max(...pixelRows.map((r) => r.length));

	// Fold pixel-row pairs into terminal rows: row r shows pixel rows 2r
	// (upper half) and 2r+1 (lower half).
	const rows: string[] = [];
	for (let r = 0; r < 3; r++) {
		const upper = pixelRows[r * 2] ?? "";
		const lower = pixelRows[r * 2 + 1] ?? "";
		let line = "";
		for (let x = 0; x < width; x++) {
			const top = upper[x] === "#";
			const bottom = lower[x] === "#";
			line +=
				top && bottom
					? HALF.both
					: top
						? HALF.top
						: bottom
							? HALF.bottom
							: HALF.none;
		}
		rows.push(line);
	}

	return { rows, width };
}

/**
 * Rasterize a word and paint it with ANSI escapes, applying a per-column
 * brightness ramp so the mark brightens from left to right.
 *
 * Returns the painted rows plus the mark's visible width in cells — callers
 * need the width to center it, since the painted strings carry escape bytes
 * that make `.length` useless for measurement.
 */
export function renderWordmark(word: string): {
	rows: string[];
	width: number;
} {
	const { rows, width } = rasterizeWordmark(word);

	return {
		width,
		rows: rows.map((row) =>
			[...row]
				.map((cell, x) =>
					// Blank cells stay unpainted so we never emit escapes for spaces.
					cell === HALF.none
						? cell
						: theme.wordmark(cell, width > 1 ? x / (width - 1) : 1),
				)
				.join(""),
		),
	};
}

// ─── Slab composition ───────────────────────────────────────────────────────

/**
 * How a run of slab text is painted. Named tiers rather than raw tokens so
 * call sites stay declarative and the brightness hierarchy is enforced in one
 * place: `bold` > `text` > `muted` > `faint`, plus `cursor` for the inverted
 * block cursor.
 */
export type Tier = "bold" | "text" | "muted" | "faint" | "cursor";

/** A run of slab text: the string, and which tier paints it. */
export type Segment = readonly [text: string, tier: Tier];

const TIERS: Record<Tier, (t: string) => string> = {
	bold: (t) => theme.bold(theme.onSurface(t)),
	text: (t) => theme.onSurface(t),
	muted: (t) => theme.onSurfaceMuted(t),
	faint: (t) => theme.onSurfaceFaint(t),
	cursor: (t) => theme.cursor(t),
};

/**
 * Build one row of the slab: the left hairline bar, a cell of padding, the
 * row's segments, then filler out to `width` so the fill reads as a solid
 * rectangle.
 *
 * Content wider than the slab is truncated rather than wrapped, so a narrow
 * terminal degrades without breaking the grid.
 */
export function slabRow(segments: readonly Segment[], width = panelWidth()): string {
	const bar = theme.surfaceBar(GLYPH.bar);
	const inner = Math.max(0, width - 2); // minus the bar and one pad cell

	let used = 0;
	let body = "";
	for (const [text, tier] of segments) {
		if (used >= inner) break;
		const room = inner - used;
		const slice = text.length > room ? text.slice(0, room) : text;
		body += TIERS[tier](slice);
		used += slice.length;
	}

	const filler = inner - used;
	return (
		bar +
		theme.surface(" ") +
		body +
		(filler > 0 ? theme.surface(" ".repeat(filler)) : "")
	);
}

/** Visible width of a `[text, tier][]` row, ignoring escape bytes. */
export function segmentsWidth(segments: readonly Segment[]): number {
	return segments.reduce((n, [text]) => n + text.length, 0);
}

// ─── Splash-grammar primitives ──────────────────────────────────────────────

/**
 * Print the block wordmark, centered on the viewport.
 *
 *   ▄▀▀▄ ...
 */
export function wordmark(word: string): void {
	const mark = renderWordmark(word);
	const indent = " ".repeat(Math.max(0, Math.floor((columns() - mark.width) / 2)));
	for (const row of mark.rows) console.log(indent + row);
}

/**
 * Print a centered slab holding the given content rows. A blank pad row is
 * added above and below the content, matching the splash panel's proportions.
 *
 *   ▎ Serving · http://localhost:3000  OpenRouter
 */
export function panel(contentRows: readonly (readonly Segment[])[]): void {
	const width = panelWidth();
	const indent = " ".repeat(panelLeft());
	console.log(indent + slabRow([], width));
	for (const row of contentRows) console.log(indent + slabRow(row, width));
	console.log(indent + slabRow([], width));
}

/**
 * Print keybinding-style hints, right-aligned flush with the slab's right
 * edge: the key bright and bold, its action muted.
 *
 *                                       enter optimize   ctrl+p commands
 */
export function keys(pairs: readonly (readonly [string, string])[]): void {
	const plain = pairs.map(([k, a]) => `${k} ${a}`).join("   ");
	const painted = pairs
		.map(([k, a]) => `${theme.bold(theme.text(k))} ${theme.textMuted(a)}`)
		.join("   ");
	const left = Math.max(0, panelLeft() + panelWidth() - plain.length);
	console.log(" ".repeat(left) + painted);
}

/**
 * Print the centered amber tip line — the single warm highlight in the
 * palette, with the actionable command brightest.
 *
 *   ● Tip Run /start to launch the gateway
 */
export function tip(command: string, text: string): void {
	const plain = `${GLYPH.tip} Tip Run ${command} ${text}`;
	const painted =
		`${theme.tip(GLYPH.tip)} ${theme.tip("Tip")} ` +
		`${theme.textMuted("Run")} ${theme.bold(theme.text(command))} ` +
		`${theme.textMuted(text)}`;
	console.log(
		" ".repeat(Math.max(0, Math.floor((columns() - plain.length) / 2))) + painted,
	);
}

/**
 * Print the footer row: the shell-style cwd at the far left, the version at
 * the far right, both muted.
 *
 *   ~/llm-guardian                                            1.6.26
 */
export function footer(version: string, cwd = homeRelative(process.cwd())): void {
	const fill = Math.max(1, columns() - 4 - cwd.length - version.length);
	console.log(
		`  ${theme.textMuted(cwd)}${" ".repeat(fill)}${theme.textMuted(version)}`,
	);
}

/**
 * Collapse the user's home directory to `~` the way a shell prompt would, so
 * the footer stays short regardless of how deep the cwd is.
 */
export function homeRelative(dir: string): string {
	const home = process.env.HOME || process.env.USERPROFILE || "";
	if (!home) return dir;
	const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
	const d = norm(dir);
	const h = norm(home);
	if (d === h) return "~";
	if (d.startsWith(`${h}/`)) return `~${d.slice(h.length)}`;
	return dir;
}

// ─── Inline-grammar primitives ──────────────────────────────────────────────

/** Blank spacer line. */
export function blank(): void {
	console.log("");
}

/**
 * Section header — a primary accent glyph, a bold title, and an optional
 * muted descriptor. Never a box.
 *
 *   ◆ LLM-Guardian  token optimization, zero config
 */
export function header(title: string, descriptor?: string): void {
	const line = descriptor
		? `${theme.primary(GLYPH.brand)} ${theme.bold(theme.text(title))}  ${theme.textMuted(descriptor)}`
		: `${theme.primary(GLYPH.brand)} ${theme.bold(theme.text(title))}`;
	console.log(line);
}

/** Thin muted horizontal rule — the only separator we use. */
export function rule(width = 46): void {
	console.log(theme.rule("─".repeat(width)));
}

/**
 * Key/value row with a muted, right-aligned label.
 *
 *   listening          http://localhost:3000
 */
export function kv(label: string, value: string): void {
	console.log(`  ${theme.textMuted(padLabel(label))}${theme.text(value)}`);
}

/** A step line for startup sequences / progress. */
export function step(text: string): void {
	console.log(`  ${theme.secondary(GLYPH.step)} ${theme.text(text)}`);
}

/** A plain bullet item. */
export function item(text: string): void {
	console.log(`  ${theme.textMuted(GLYPH.bullet)} ${theme.text(text)}`);
}

/** Success line. */
export function success(text: string): void {
	console.log(`  ${theme.success(GLYPH.ok)} ${theme.text(text)}`);
}

/** Warning line. */
export function warn(text: string): void {
	console.log(`  ${theme.warning(GLYPH.warn)} ${theme.text(text)}`);
}

/** Error line. */
export function error(text: string): void {
	console.log(`  ${theme.error(GLYPH.err)} ${theme.text(text)}`);
}

/** Muted hint line — for "next step" guidance, shown dimmed. */
export function hint(text: string): void {
	console.log(`  ${theme.dim(theme.textMuted(text))}`);
}

/**
 * A labelled stat pair used in results blocks: muted label, colored value.
 * Value color is chosen by the caller via a token function.
 */
export function stat(
	label: string,
	value: string,
	paint: (t: string) => string = theme.text,
): void {
	console.log(`  ${theme.textMuted(padLabel(label))}${paint(value)}`);
}

/**
 * Section sub-heading inside a results block — bold text with an accent
 * glyph.
 *
 *   › Semantic Folding
 */
export function section(title: string): void {
	console.log(`${theme.primary(GLYPH.step)} ${theme.bold(theme.text(title))}`);
}
