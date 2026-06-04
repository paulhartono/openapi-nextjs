/**
 * Integration test: run the *built* bin through a symlink, the way npx and
 * `node_modules/.bin` actually invoke it.
 *
 * The unit tests call `parseCliArgs`/`main` directly, so they never exercise the
 * entrypoint guard at the bottom of cli.ts. That guard regressed in 0.1.1: it
 * compared `import.meta.url` to `pathToFileURL(argv[1])`, but argv[1] under a bin
 * symlink is the symlink path while import.meta.url is the real file — they never
 * matched, so `main()` never ran and every invocation exited 0 with no output.
 *
 * This test reproduces that exact setup: build dist/cli.js, symlink to it, run the
 * symlink as a Node process, and assert real output + exit codes.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execPath } from "node:process";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const distCli = join(repoRoot, "dist", "cli.js");

let binLink: string;

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Invoke the bin through its symlink, mirroring how npx / .bin run it. */
function runBin(args: readonly string[]): RunResult {
  const result = spawnSync(execPath, [binLink, ...args], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("built bin (invoked through a symlink)", () => {
  beforeAll(() => {
    if (!existsSync(distCli)) {
      // The bug only manifests in the bundled output, so the build must exist.
      execFileSync("pnpm", ["build"], { cwd: repoRoot, stdio: "inherit" });
    }
    const dir = mkdtempSync(join(tmpdir(), "onx-bin-"));
    binLink = join(dir, "openapi-nextjs");
    symlinkSync(distCli, binLink);
  });

  it("prints usage to stdout and exits 0 on --help", () => {
    const { status, stdout } = runBin(["--help"]);
    expect(status).toBe(0);
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("openapi-nextjs");
  });

  it("errors to stderr and exits non-zero when run with no arguments", () => {
    const { status, stderr } = runBin([]);
    expect(status).not.toBe(0);
    expect(stderr.length).toBeGreaterThan(0);
    expect(stderr).toContain("Unknown command");
  });

  it("reports a missing spec to stderr and exits non-zero on `generate`", () => {
    const { status, stderr } = runBin(["generate"]);
    expect(status).not.toBe(0);
    expect(stderr).toContain("Missing <spec>");
  });
});
