import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadSpec, normalizeSchema } from "../../src/spec/load.js";
import type { OpenAPIDocument, SchemaObject } from "../../src/spec/types.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

describe("loadSpec", () => {
  it("loads a YAML spec", async () => {
    const { dereferenced, bundled } = await loadSpec(join(fixturesDir, "minimal.yaml"));
    expect(dereferenced.info.title).toBe("Minimal API");
    expect(bundled.info.title).toBe("Minimal API");
    expect(dereferenced.paths?.["/ping"]?.get?.operationId).toBe("ping");
  });

  it("loads a JSON spec equivalently to YAML", async () => {
    const fromJson = await loadSpec(join(fixturesDir, "minimal.json"));
    const fromYaml = await loadSpec(join(fixturesDir, "minimal.yaml"));
    expect(fromJson.dereferenced.paths?.["/ping"]?.get?.operationId).toBe(
      fromYaml.dereferenced.paths?.["/ping"]?.get?.operationId,
    );
  });

  it("loads an in-memory object without mutating the input", async () => {
    const input: OpenAPIDocument = {
      openapi: "3.0.3",
      info: { title: "Inline", version: "1.0.0" },
      paths: { "/x": { get: { operationId: "getX" } } },
    };
    const snapshot = structuredClone(input);
    await loadSpec(input);
    expect(input).toEqual(snapshot);
  });

  it("dereferences internal $refs in the dereferenced view", async () => {
    const { dereferenced } = await loadSpec(join(fixturesDir, "edge-cases.yaml"));
    const schema = dereferenced.paths?.["/users/{userId}/posts"]?.post?.requestBody;
    expect(schema && "content" in schema).toBe(true);
    const body = schema as { content: Record<string, { schema: SchemaObject }> };
    // $ref to Post resolved to a concrete object schema.
    expect(body.content["application/json"]?.schema.type).toBe("object");
  });

  it("preserves internal $refs in the bundled view", async () => {
    const { bundled } = await loadSpec(join(fixturesDir, "edge-cases.yaml"));
    const responses = bundled.paths?.["/users/{userId}/posts"]?.get?.responses;
    const ok = responses?.["200"] as {
      content: Record<string, { schema: { $ref?: string } }>;
    };
    expect(ok.content["application/json"]?.schema.$ref).toBe(
      "#/components/schemas/PostList",
    );
  });

  it("terminates on circular $refs (does not hang or throw)", async () => {
    await expect(loadSpec(join(fixturesDir, "edge-cases.yaml"))).resolves.toBeDefined();
  });
});

describe("normalizeSchema", () => {
  it("collapses 3.1 type:[T,null] into type T + nullable", () => {
    const schema = { type: ["string", "null"] } as unknown as SchemaObject;
    normalizeSchema(schema);
    expect(schema.type).toBe("string");
    expect(schema.nullable).toBe(true);
  });

  it("drops type when only null is present", () => {
    const schema = { type: ["null"] } as unknown as SchemaObject;
    normalizeSchema(schema);
    expect(schema.type).toBeUndefined();
    expect(schema.nullable).toBe(true);
  });

  it("leaves a 3.0 nullable schema as-is", () => {
    const schema: SchemaObject = { type: "string", nullable: true };
    normalizeSchema(schema);
    expect(schema.type).toBe("string");
    expect(schema.nullable).toBe(true);
  });

  it("marks an enum containing null as nullable", () => {
    const schema: SchemaObject = { type: "string", enum: ["a", "b", null] };
    normalizeSchema(schema);
    expect(schema.nullable).toBe(true);
  });

  it("is idempotent", () => {
    const schema = { type: ["integer", "null"] } as unknown as SchemaObject;
    normalizeSchema(schema);
    const once = structuredClone(schema);
    normalizeSchema(schema);
    expect(schema).toEqual(once);
  });
});
