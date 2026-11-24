// End-to-end CLI tests — spawn the real entry point.
//
// These lock behavior that unit tests on the primitives can't see: argument
// routing (`--help` must reach commander, not the chat), input validation, and
// the exit codes scripts depend on. Every run is non-TTY, so output is the
// plain-text fallback.

import { describe, expect, it } from "bun:test";
import pkg from "../../package.json";

const ENTRY = `${import.meta.dir}/index.ts`;

async function guardian(...args: string[]) {
	const proc = Bun.spawn(["bun", ENTRY, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, NO_COLOR: "1" },
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { stdout, stderr, code };
}

describe("argument routing", () => {
	it("--help prints usage instead of the splash", async () => {
		for (const flag of ["--help", "-h"]) {
			const { stdout, code } = await guardian(flag);
			expect(code).toBe(0);
			expect(stdout).toContain("Usage: guardian");
			expect(stdout).toContain("optimize");
			// The bare-invocation chat flags are documented too.
			expect(stdout).toContain("--lm-studio");
		}
	});

	it("--version prints just the package version", async () => {
		for (const flag of ["--version", "-V"]) {
			const { stdout, code } = await guardian(flag);
			expect(code).toBe(0);
			expect(stdout.trim()).toBe(pkg.version);
		}
	});

	it("a bare, piped invocation prints the static splash with real commands", async () => {
		const { stdout, code } = await guardian();
		expect(code).toBe(0);
		expect(stdout).toContain(pkg.version);
		expect(stdout).toContain("guardian start");
		expect(stdout).not.toContain("ctrl+p");
	});
});

describe("optimize", () => {
	it("explains a zero reduction instead of showing a bare 0%", async () => {
		const { stdout, code } = await guardian("optimize", "hello there");
		expect(code).toBe(0);
		expect(stdout).toContain("no reduction");
		expect(stdout).toContain("Already compact");
		// The slab shares a left edge with the stat rows beneath it.
		const slab = stdout.split("\n").find((l) => l.includes("Folded")) ?? "";
		const stat = stdout.split("\n").find((l) => l.includes("tokens saved")) ?? "";
		expect(slab.indexOf("▎")).toBe(2);
		expect(stat.indexOf("tokens saved")).toBe(2);
	});

	it("reports a real reduction with a filled meter", async () => {
		const long = "Please could you kindly review the following document. ".repeat(40);
		const { stdout } = await guardian("optimize", long);
		expect(stdout).toMatch(/\d+\.\d% smaller/);
		expect(stdout).toContain("█");
		expect(stdout).not.toContain("Already compact");
	});

	it("rejects a bad --max-tokens with a message and a non-zero exit", async () => {
		const { stdout, code } = await guardian("optimize", "x", "--max-tokens", "0");
		expect(code).toBe(1);
		expect(stdout).toContain('Invalid --max-tokens "0"');
	});
});

describe("start", () => {
	it("rejects an out-of-range port before binding anything", async () => {
		for (const port of ["abc", "0", "70000"]) {
			const { stdout, code } = await guardian("start", "--port", port);
			expect(code).toBe(1);
			expect(stdout).toContain(`Invalid port "${port}"`);
		}
	});

	it("rejects a bad budget", async () => {
		const { stdout, code } = await guardian("start", "--daily-budget", "lots");
		expect(code).toBe(1);
		expect(stdout).toContain('Invalid --daily-budget "lots"');
	});

	it("reports a port conflict instead of a banner and a stack trace", async () => {
		const blocker = Bun.serve({ port: 0, fetch: () => new Response("busy") });
		try {
			const { stdout, code } = await guardian(
				"start",
				"--port",
				String(blocker.port),
				"--lm-studio",
			);
			expect(code).toBe(1);
			expect(stdout).toContain(`Port ${blocker.port} is already in use`);
			// The banner must not claim a server that never started.
			expect(stdout).not.toContain("Serving");
		} finally {
			blocker.stop(true);
		}
	});
});
