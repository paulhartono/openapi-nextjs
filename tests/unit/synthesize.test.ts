import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadSpec } from "../../src/spec/load.js";
import {
  synthesizeFromSchema,
  synthesizeMock,
} from "../../src/mock/synthesize.js";
import type {
  MediaTypeObject,
  SchemaObject,
} from "../../src/spec/types.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

describe("synthesizeFromSchema — example-first", () => {
  it("returns a schema `example` verbatim", () => {
    const schema: SchemaObject = { type: "string", example: "hello" };
    expect(synthesizeFromSchema(schema)).toBe("hello");
  });

  it("uses examples[0] when no example is present", () => {
    const schema: SchemaObject = { type: "integer", examples: [42, 43] };
    expect(synthesizeFromSchema(schema)).toBe(42);
  });

  it("treats an explicit null example as a value", () => {
    const schema: SchemaObject = { type: "string", example: null };
    expect(synthesizeFromSchema(schema)).toBeNull();
  });
});

describe("synthesizeMock — media examples take precedence", () => {
  it("uses a media-level example over schema synthesis", () => {
    const media: MediaTypeObject = {
      schema: { type: "string" },
      example: "from-media",
    };
    expect(synthesizeMock(media)).toBe("from-media");
  });

  it("uses the first media `examples` value", () => {
    const media: MediaTypeObject = {
      schema: { type: "string" },
      examples: { sample: { value: "from-examples" } },
    };
    expect(synthesizeMock(media)).toBe("from-examples");
  });

  it("falls back to schema synthesis with no examples", () => {
    const media: MediaTypeObject = { schema: { type: "boolean" } };
    expect(synthesizeMock(media)).toBe(true);
  });

  it("returns null for an undefined media object", () => {
    expect(synthesizeMock(undefined)).toBeNull();
  });
});

describe("synthesizeFromSchema — primitives", () => {
  it("synthesizes a plain string", () => {
    expect(synthesizeFromSchema({ type: "string" })).toBe("string");
  });

  it("synthesizes format-specific strings", () => {
    expect(synthesizeFromSchema({ type: "string", format: "uuid" })).toBe(
      "00000000-0000-0000-0000-000000000000",
    );
    expect(synthesizeFromSchema({ type: "string", format: "email" })).toBe(
      "user@example.com",
    );
    expect(synthesizeFromSchema({ type: "string", format: "url" })).toBe(
      "https://example.com",
    );
    expect(synthesizeFromSchema({ type: "string", format: "uri" })).toBe(
      "https://example.com",
    );
    expect(synthesizeFromSchema({ type: "string", format: "date-time" })).toBe(
      "1970-01-01T00:00:00Z",
    );
    expect(synthesizeFromSchema({ type: "string", format: "date" })).toBe(
      "1970-01-01",
    );
  });

  it("pads a string to minLength", () => {
    const value = synthesizeFromSchema({ type: "string", minLength: 10 });
    expect(value).toBe("stringxxxx");
  });

  it("uses minimum for numbers, else 0", () => {
    expect(synthesizeFromSchema({ type: "integer", minimum: 5 })).toBe(5);
    expect(synthesizeFromSchema({ type: "integer" })).toBe(0);
    expect(synthesizeFromSchema({ type: "number" })).toBe(0);
  });

  it("synthesizes booleans as true", () => {
    expect(synthesizeFromSchema({ type: "boolean" })).toBe(true);
  });
});

describe("synthesizeFromSchema — enum / const", () => {
  it("uses the first non-null enum member", () => {
    expect(synthesizeFromSchema({ type: "string", enum: ["a", "b"] })).toBe("a");
  });

  it("skips a leading null enum member", () => {
    expect(
      synthesizeFromSchema({ type: "string", enum: [null, "x"] }),
    ).toBe("x");
  });

  it("uses a const value", () => {
    expect(synthesizeFromSchema({ const: "fixed" })).toBe("fixed");
  });
});

describe("synthesizeFromSchema — objects", () => {
  it("includes required and optional properties", () => {
    const schema: SchemaObject = {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", format: "uuid" },
        name: { type: "string" },
        count: { type: "integer", minimum: 1 },
      },
    };
    expect(synthesizeFromSchema(schema)).toEqual({
      id: "00000000-0000-0000-0000-000000000000",
      name: "string",
      count: 1,
    });
  });

  it("returns an empty object for additionalProperties-only schemas", () => {
    const schema: SchemaObject = {
      type: "object",
      additionalProperties: { type: "string" },
    };
    expect(synthesizeFromSchema(schema)).toEqual({});
  });
});

describe("synthesizeFromSchema — arrays", () => {
  it("synthesizes a single-element array", () => {
    const schema: SchemaObject = { type: "array", items: { type: "string" } };
    expect(synthesizeFromSchema(schema)).toEqual(["string"]);
  });

  it("repeats up to minItems, capped at 3", () => {
    const schema: SchemaObject = {
      type: "array",
      items: { type: "integer", minimum: 7 },
      minItems: 5,
    };
    expect(synthesizeFromSchema(schema)).toEqual([7, 7, 7]);
  });

  it("returns an empty array when items is missing", () => {
    expect(synthesizeFromSchema({ type: "array" })).toEqual([]);
  });
});

describe("synthesizeFromSchema — composition", () => {
  it("merges allOf object members", () => {
    const schema: SchemaObject = {
      allOf: [
        { type: "object", properties: { a: { type: "string" } } },
        { type: "object", properties: { b: { type: "integer", minimum: 2 } } },
      ],
    };
    expect(synthesizeFromSchema(schema)).toEqual({ a: "string", b: 2 });
  });

  it("synthesizes the first oneOf member", () => {
    const schema: SchemaObject = {
      oneOf: [{ type: "boolean" }, { type: "string" }],
    };
    expect(synthesizeFromSchema(schema)).toBe(true);
  });

  it("synthesizes the first anyOf member", () => {
    const schema: SchemaObject = {
      anyOf: [{ type: "integer", minimum: 9 }, { type: "string" }],
    };
    expect(synthesizeFromSchema(schema)).toBe(9);
  });
});

describe("synthesizeFromSchema — nullable", () => {
  it("returns null for a null-only schema", () => {
    expect(synthesizeFromSchema({ type: "null" })).toBeNull();
  });

  it("returns null for a typeless schema", () => {
    expect(synthesizeFromSchema({ nullable: true })).toBeNull();
  });
});

describe("synthesizeFromSchema — cycle and depth guards", () => {
  it("terminates on a hand-built circular schema", () => {
    const post: SchemaObject = { type: "object", properties: {} };
    const author: SchemaObject = {
      type: "object",
      properties: { posts: { type: "array", items: post } },
    };
    post.properties = {
      id: { type: "string" },
      author,
    };

    let result: unknown;
    expect(() => {
      result = synthesizeFromSchema(post);
    }).not.toThrow();

    // Finite structure: the recursion stops rather than looping forever.
    const obj = result as { id: string; author: { posts: unknown[] } };
    expect(obj.id).toBe("string");
    expect(Array.isArray(obj.author.posts)).toBe(true);
  });

  it("terminates on the circular edge-cases.yaml spec", async () => {
    const { dereferenced } = await loadSpec(join(fixturesDir, "edge-cases.yaml"));
    const post = dereferenced.components?.schemas?.Post as SchemaObject;

    let result: unknown;
    expect(() => {
      result = synthesizeFromSchema(post);
    }).not.toThrow();

    const obj = result as { id: unknown; title: unknown };
    expect(obj.id).toBe("00000000-0000-0000-0000-000000000000");
    expect(obj.title).toBe("string");
  });

  it("fills a cycle stop value with the schema's required properties", async () => {
    // At the cycle point (Author.posts → Post, already on the path), the inner
    // Post must still satisfy its required shape ({ id, title }) — an empty {}
    // would fail the generated zod/type for Post.
    const { dereferenced } = await loadSpec(join(fixturesDir, "edge-cases.yaml"));
    const post = dereferenced.components?.schemas?.Post as SchemaObject;

    const result = synthesizeFromSchema(post) as {
      author?: { posts?: { id?: unknown; title?: unknown }[] };
    };
    const inner = result.author?.posts?.[0];
    expect(inner).toBeDefined();
    expect(inner?.id).toBe("00000000-0000-0000-0000-000000000000");
    expect(inner?.title).toBe("string");
  });

  it("stops at the configured maxDepth on a deep linear schema", () => {
    // Build a 20-deep nested-object chain (acyclic) — depth must bound it.
    let schema: SchemaObject = { type: "string" };
    for (let i = 0; i < 20; i++) {
      schema = { type: "object", required: ["next"], properties: { next: schema } };
    }
    let result: unknown;
    expect(() => {
      result = synthesizeFromSchema(schema, { maxDepth: 3 });
    }).not.toThrow();
    expect(result).toBeTypeOf("object");
  });
});
