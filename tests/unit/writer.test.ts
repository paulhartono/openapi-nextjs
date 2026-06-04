import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeAll } from "../../src/fs/writer.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "openapi-nextjs-writer-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("writeAll", () => {
  it("formats source through prettier before writing", async () => {
    const path = join(dir, "ugly.ts");
    await writeAll([
      { path, source: "export   const  x={a:1,b:2}", policy: "overwrite" },
    ]);
    const content = await readFile(path, "utf8");
    expect(content).toBe("export const x = { a: 1, b: 2 };\n");
  });

  it("creates nested directories on demand", async () => {
    const path = join(dir, "a", "b", "c", "file.ts");
    const summary = await writeAll([
      { path, source: "export const y = 1;", policy: "overwrite" },
    ]);
    expect(summary.written).toEqual([path]);
    expect(await readFile(path, "utf8")).toBe("export const y = 1;\n");
  });

  it("skips an existing file under skip-if-exists and preserves its content", async () => {
    const path = join(dir, "route.ts");
    await writeFile(path, "// hand-written\n", "utf8");
    const summary = await writeAll([
      { path, source: "export const replaced = true;", policy: "skip-if-exists" },
    ]);
    expect(summary.skipped).toEqual([path]);
    expect(summary.written).toEqual([]);
    expect(await readFile(path, "utf8")).toBe("// hand-written\n");
  });

  it("overwrites an existing file under overwrite", async () => {
    const path = join(dir, "gen.ts");
    await writeFile(path, "old", "utf8");
    const summary = await writeAll([
      { path, source: "export const fresh = 1;", policy: "overwrite" },
    ]);
    expect(summary.written).toEqual([path]);
    expect(await readFile(path, "utf8")).toBe("export const fresh = 1;\n");
  });

  it("writes a fresh file even under skip-if-exists", async () => {
    const path = join(dir, "new.ts");
    const summary = await writeAll([
      { path, source: "export const z = 1;", policy: "skip-if-exists" },
    ]);
    expect(summary.written).toEqual([path]);
  });
});
