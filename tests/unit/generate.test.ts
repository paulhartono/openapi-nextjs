import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { generate } from "../../src/generate.js";
import type { GenerateOptions } from "../../src/config.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const spec = join(fixturesDir, "edge-cases.yaml");

let dir: string;
let routeDir: string;
let typesDir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "openapi-nextjs-generate-"));
  routeDir = join(dir, "app", "api");
  typesDir = join(dir, "types");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const baseOptions = (): GenerateOptions => ({
  input: spec,
  routeDir,
  typesDir,
  overwrite: false,
});

const routeFileDir = (): string => join(routeDir, "users", "[userId]", "posts");

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("generate — edge-cases spec", () => {
  it("emits the expected file tree", async () => {
    const result = await generate(baseOptions());
    expect(result.routeCount).toBe(1);
    expect(await exists(join(routeDir, "_schemas.generated.ts"))).toBe(true);
    expect(await exists(join(routeFileDir(), "route.ts"))).toBe(true);
    expect(await exists(join(routeFileDir(), "route.generated.ts"))).toBe(true);
    expect(await exists(join(typesDir, "api.generated.ts"))).toBe(true);
  });

  it("emits all component schemas into the shared file", async () => {
    await generate(baseOptions());
    const schemas = await readFile(join(routeDir, "_schemas.generated.ts"), "utf8");
    expect(schemas).toContain("export const PostSchema");
    expect(schemas).toContain("export const AuthorSchema");
    expect(schemas).toContain("export const PostListSchema");
  });

  it("preserves a hand-edited route.ts on re-run without --overwrite", async () => {
    await generate(baseOptions());
    const routePath = join(routeFileDir(), "route.ts");
    const edited = "// my handler logic\nexport const MARKER = true;\n";
    await writeFile(routePath, edited, "utf8");

    const result = await generate(baseOptions());
    expect(result.skipped).toContain(routePath);
    expect(await readFile(routePath, "utf8")).toBe(edited);
  });

  it("regenerates route.generated.ts byte-identically", async () => {
    await generate(baseOptions());
    const genPath = join(routeFileDir(), "route.generated.ts");
    const first = await readFile(genPath, "utf8");
    await generate(baseOptions());
    const second = await readFile(genPath, "utf8");
    expect(second).toBe(first);
  });

  it("rewrites route.ts when --overwrite is set", async () => {
    await generate(baseOptions());
    const routePath = join(routeFileDir(), "route.ts");
    await writeFile(routePath, "// stale\n", "utf8");

    const result = await generate({ ...baseOptions(), overwrite: true });
    expect(result.written).toContain(routePath);
    expect(await readFile(routePath, "utf8")).not.toBe("// stale\n");
  });
});
