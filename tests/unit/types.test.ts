import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadSpec } from "../../src/spec/load.js";
import { emitTypes } from "../../src/emit/types.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

describe("emitTypes — from the bundled minimal fixture", () => {
  it("emits the paths/operations interfaces for the spec", async () => {
    const { bundled } = await loadSpec(join(fixturesDir, "minimal.yaml"));
    const out = await emitTypes(bundled);

    expect(out).toContain("export interface paths");
    expect(out).toContain('"/ping"');
    expect(out).toContain("export interface operations");
    expect(out).toContain("ping");
  });

  it("is pure — emits no auto-generated banner", async () => {
    const { bundled } = await loadSpec(join(fixturesDir, "minimal.yaml"));
    const out = await emitTypes(bundled);

    expect(out).not.toContain("auto-generated");
    expect(out).not.toContain("Do not make direct changes");
  });
});

describe("emitTypes — from the bundled edge-cases fixture", () => {
  it("emits named component aliases referenced (not inlined) by name", async () => {
    const { bundled } = await loadSpec(join(fixturesDir, "edge-cases.yaml"));
    const out = await emitTypes(bundled);

    expect(out).toContain("export interface components");
    expect(out).toContain("Post:");
    expect(out).toContain("Author:");
    expect(out).toContain("PostList:");
    expect(out).toContain('components["schemas"]["Post"]');
  });

  it("normalizes both nullable spellings to `… | null`", async () => {
    const { bundled } = await loadSpec(join(fixturesDir, "edge-cases.yaml"));
    const out = await emitTypes(bundled);

    // `summary` (3.1 `type: [string, null]`) and `nextCursor` (3.0 `nullable: true`)
    // both arrive normalized and surface as `string | null`.
    expect(out).toContain("string | null");
  });

  it("carries schema format annotations and synthesized path keys", async () => {
    const { bundled } = await loadSpec(join(fixturesDir, "edge-cases.yaml"));
    const out = await emitTypes(bundled);

    expect(out).toContain("Format: uuid");
    expect(out).toContain('"/users/{userId}/posts"');
  });
});

describe("emitTypes — JSON spec parity", () => {
  it("produces the same path output from a JSON spec", async () => {
    const { bundled } = await loadSpec(join(fixturesDir, "minimal.json"));
    const out = await emitTypes(bundled);

    expect(out).toContain('"/ping"');
  });
});

describe("emitTypes — determinism", () => {
  it("emits byte-identical output across repeated calls", async () => {
    const { bundled } = await loadSpec(join(fixturesDir, "edge-cases.yaml"));
    const a = await emitTypes(bundled);
    const b = await emitTypes(bundled);

    expect(a).toBe(b);
  });
});
