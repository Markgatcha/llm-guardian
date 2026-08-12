// Splash / CLI design-language tests.
//
// These lock the grid geometry and the color-degradation contract, which are
// the two things that silently rot: a stray blank row shifts the whole
// composition, and an unconditional escape sequence corrupts piped output.
//
// Every assertion runs with color DISABLED (tests are not a TTY), so the
// strings here are the plain-text fallback — exactly what CI and piped
// consumers see.

import { describe, expect, it } from "bun:test";
import { composeSplash } from "./splash.ts";
import {
	panelLeft,
	panelWidth,
	rasterizeWordmark,
	renderWordmark,
	segmentsWidth,
	slabRow,
} from "./ui.ts";

describe("wordmark rasterizer", () => {
	it("renders exactly three terminal rows", () => {
		expect(renderWordmark("guardian").rows).toHaveLength(3);
	});

	it("reports a width matching every rendered row", () => {
		const { rows, width } = renderWordmark("guardian");
		// Color is off in tests, so row length is the visible cell count.
		for (const row of rows) expect(row.length).toBe(width);
	});

	it("sizes each glyph to its own bitmap width plus 1-cell gaps", () => {
		// Small-caps bitmaps are 5 cells wide except `i` (1), and 8 glyphs
		// carry 7 single-cell gaps: (7 × 5) + 1 + 7 = 43.
		expect(renderWordmark("guardian").width).toBe(43);
		// A narrow letter stays narrow rather than padding out to 5 cells.
		expect(renderWordmark("i").width).toBe(1);
	});

	it("shares its geometry with the uncolored rasterizer", () => {
		// The TUI paints from `rasterizeWordmark`; the ANSI path wraps the same
		// rows in escapes. If these ever disagree the two renderings drift.
		const plain = rasterizeWordmark("guardian");
		const painted = renderWordmark("guardian");
		expect(plain.width).toBe(painted.width);
		// Color is off in tests, so the painted rows are the plain rows.
		expect(painted.rows).toEqual(plain.rows);
	});

	it("uses only half-block glyphs and spaces", () => {
		const { rows } = renderWordmark("guardian");
		for (const row of rows) {
			expect(row).toMatch(/^[\u2588\u2580\u2584 ]+$/);
		}
	});

	it("falls back to blank cells for unmapped characters", () => {
		// 'z' has no bitmap; the row must still be blank rather than throwing.
		expect(renderWordmark("z").rows[0]?.trim()).toBe("");
	});

	it("hangs descenders below the baseline", () => {
		// `p` inks the descender row; `o` does not. Both share the same band,
		// so only `p` should carry ink in the bottom terminal row.
		const p = renderWordmark("p").rows[2] ?? "";
		const o = renderWordmark("o").rows[2] ?? "";
		expect(p).toContain("\u2588"); // full block: baseline + descender
		expect(o).not.toContain("\u2588");
	});
});

describe("slab rows", () => {
	it("pads every row to the full panel width", () => {
		const width = panelWidth(120);
		const empty = slabRow([], width);
		const filled = slabRow([["Optimize", "bold"]], width);
		expect(empty.length).toBe(width);
		expect(filled.length).toBe(width);
	});

	it("opens with the hairline bar, never a box-drawing corner", () => {
		const row = slabRow([["x", "text"]], 50);
		expect(row.startsWith("\u258e")).toBe(true);
		expect(row).not.toMatch(/[┌┐└┘─│╔╗╚╝═║]/);
	});

	it("truncates overlong content instead of wrapping", () => {
		const row = slabRow([["y".repeat(200), "text"]], 40);
		expect(row.length).toBe(40);
		expect(row).not.toContain("\n");
	});

	it("measures segment width ignoring paint", () => {
		expect(
			segmentsWidth([
				["ab", "bold"],
				["cde", "faint"],
			]),
		).toBe(5);
	});
});

describe("panel geometry", () => {
	it("keeps the panel near 47% of the viewport and centered", () => {
		const cols = 160;
		const width = panelWidth(cols);
		const left = panelLeft(cols);
		expect(width).toBe(Math.round(cols * 0.47));
		// Equal margins either side (±1 cell for odd remainders).
		expect(Math.abs(cols - width - left * 2)).toBeLessThanOrEqual(1);
	});

	it("never collapses below the minimum width", () => {
		expect(panelWidth(20)).toBe(46);
	});

	it("never overflows a narrow viewport past its own minimum", () => {
		expect(panelWidth(200)).toBeLessThanOrEqual(196);
	});
});

describe("splash composition", () => {
	// A fixed viewport keeps the geometry assertions deterministic regardless
	// of the terminal the suite happens to run in.
	const VIEWPORT = { cols: 160, rows: 44 };
	const lines = composeSplash({ version: "9.9.9", viewport: VIEWPORT });

	it("fills the viewport height", () => {
		// One trailing row of breathing room under the footer.
		expect(lines.length).toBe(VIEWPORT.rows - 1);
	});

	it("stacks the wordmark, slab, hints, tip, and footer in order", () => {
		const firstInk = lines.findIndex((l) => l.trim().length > 0);
		const slabStart = lines.findIndex((l) => l.includes("\u258e"));
		const hints = lines.findIndex((l) => l.includes("ctrl+p"));
		const tip = lines.findIndex((l) => l.includes("Tip"));
		const footer = lines.findIndex((l) => l.includes("9.9.9"));

		expect(firstInk).toBeGreaterThan(0);
		expect(slabStart).toBeGreaterThan(firstInk + 2);
		expect(hints).toBeGreaterThan(slabStart);
		expect(tip).toBeGreaterThan(hints);
		expect(footer).toBeGreaterThan(tip);
		expect(footer).toBe(lines.length - 1);
	});

	it("renders a five-row slab: pad, prompt, blank, status, pad", () => {
		const slab = lines.filter((l) => l.includes("\u258e"));
		expect(slab).toHaveLength(5);
		expect(slab[1]).toContain("Optimize anything...");
		expect(slab[3]).toContain("Optimize \u00b7 auto");
		// Rows 0, 2 and 4 carry no text — only the bar and the fill.
		for (const i of [0, 2, 4]) {
			expect(slab[i].replace(/[\u258e ]/g, "")).toBe("");
		}
	});

	it("right-aligns the hints flush with the slab's right edge", () => {
		const hints = lines.find((l) => l.includes("ctrl+p")) ?? "";
		expect(hints.length).toBe(
			panelLeft(VIEWPORT.cols) + panelWidth(VIEWPORT.cols),
		);
	});

	it("emits no ANSI escapes when color is unavailable", () => {
		// biome-ignore lint/suspicious/noControlCharactersInRegex: asserting escapes are absent
		const ansi = /\u001b\[/;
		for (const line of lines) expect(line).not.toMatch(ansi);
	});

	it("honors caller overrides for the status line and tip", () => {
		const custom = composeSplash({
			mode: "Gateway",
			model: "claude-sonnet-4",
			provider: "Anthropic",
			tipCommand: "guardian dash",
			tipText: "to open analytics",
			viewport: VIEWPORT,
		});
		const status = custom.find((l) => l.includes("Gateway")) ?? "";
		expect(status).toContain("claude-sonnet-4");
		expect(status).toContain("Anthropic");
		expect(custom.some((l) => l.includes("guardian dash"))).toBe(true);
		expect(custom.some((l) => l.includes("to open analytics"))).toBe(true);
	});
});
