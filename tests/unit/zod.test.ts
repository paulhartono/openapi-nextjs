import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadSpec } from "../../src/spec/load.js";
import {
  buildComponentSchemas,
  emitBodySchema,
  emitParamsObject,
  schemaToZod,
} from "../../src/emit/zod.js";
import type { ZodEmitContext } from "../../src/emit/zod.js";
import type { ParamPlan } from "../../src/plan/routePlan.js";
import type { ReferenceObject, SchemaObject } from "../../src/spec/types.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

/** A resolver that mirrors the `FooSchema` convention, for unit-level tests. */
const stubResolver = (ref: string): string => `${ref.split("/").pop() ?? ""}Schema`;

const body: ZodEmitContext = { mode: "body", resolveRef: stubResolver };
const coerce: ZodEmitContext = { mode: "coerce", resolveRef: stubResolver };

const zod = (schema: SchemaObject | ReferenceObject | undefined, ctx = body): string =>
  schemaToZod(schema, ctx);

describe("schemaToZod — primitives (body mode)", () => {
  it("maps the scalar types", () => {
    expect(zod({ type: "string" })).toBe("z.string()");
    expect(zod({ type: "number" })).toBe("z.number()");
    expect(zod({ type: "integer" })).toBe("z.number().int()");
    expect(zod({ type: "boolean" })).toBe("z.boolean()");
  });

  it("emits z.unknown() for an empty or undefined schema", () => {
    expect(zod({})).toBe("z.unknown()");
    expect(zod(undefined)).toBe("z.unknown()");
  });
});

describe("schemaToZod — string formats (zod 4)", () => {
  it("maps known formats to zod 4 helpers", () => {
    expect(zod({ type: "string", format: "uuid" })).toBe("z.uuid()");
    expect(zod({ type: "string", format: "email" })).toBe("z.email()");
    expect(zod({ type: "string", format: "uri" })).toBe("z.url()");
    expect(zod({ type: "string", format: "url" })).toBe("z.url()");
    expect(zod({ type: "string", format: "date-time" })).toBe("z.iso.datetime()");
    expect(zod({ type: "string", format: "date" })).toBe("z.iso.date()");
  });

  it("ignores an unknown format", () => {
    expect(zod({ type: "string", format: "byte" })).toBe("z.string()");
  });
});

describe("schemaToZod — string constraints", () => {
  it("appends min/max/regex", () => {
    expect(zod({ type: "string", minLength: 1, maxLength: 5 })).toBe(
      "z.string().min(1).max(5)",
    );
    expect(zod({ type: "string", pattern: "^a/b$" })).toBe("z.string().regex(/^a\\/b$/)");
  });
});

describe("schemaToZod — number constraints", () => {
  it("maps inclusive bounds", () => {
    expect(zod({ type: "number", minimum: 0, maximum: 10 })).toBe(
      "z.number().min(0).max(10)",
    );
  });

  it("maps 3.1 numeric exclusive bounds", () => {
    expect(zod({ type: "number", exclusiveMinimum: 0, exclusiveMaximum: 10 })).toBe(
      "z.number().gt(0).lt(10)",
    );
  });

  it("maps the 3.0 boolean exclusive form against the paired bound", () => {
    expect(zod({ type: "number", minimum: 5, exclusiveMinimum: true })).toBe(
      "z.number().gt(5)",
    );
  });
});

describe("schemaToZod — coerce mode", () => {
  it("coerces number and integer leaves", () => {
    expect(zod({ type: "number" }, coerce)).toBe("z.coerce.number()");
    expect(zod({ type: "integer" }, coerce)).toBe("z.coerce.number().int()");
  });

  it("emits a string enum for boolean params — never z.coerce.boolean()", () => {
    const out = zod({ type: "boolean" }, coerce);
    expect(out).toBe(`z.enum(["true", "false"]).transform((v) => v === "true")`);
    expect(out).not.toContain("z.coerce.boolean");
  });

  it("resets to body mode inside object properties", () => {
    const out = zod(
      { type: "object", properties: { n: { type: "number" } }, required: ["n"] },
      coerce,
    );
    expect(out).toBe("z.object({ n: z.number() })");
    expect(out).not.toContain("z.coerce");
  });

  it("keeps coercion on items of a primitive array (repeated query params)", () => {
    expect(zod({ type: "array", items: { type: "number" } }, coerce)).toBe(
      "z.array(z.coerce.number())",
    );
  });
});

describe("schemaToZod — nullable and default", () => {
  it("applies nullable then default", () => {
    expect(zod({ type: "string", nullable: true })).toBe("z.string().nullable()");
    expect(zod({ type: "string", nullable: true, default: "x" })).toBe(
      'z.string().nullable().default("x")',
    );
  });
});

describe("schemaToZod — enum and const", () => {
  it("maps string enums", () => {
    expect(zod({ type: "string", enum: ["a", "b"] })).toBe('z.enum(["a", "b"])');
  });

  it("maps a single-value enum to a literal", () => {
    expect(zod({ enum: ["only"] })).toBe('z.literal("only")');
  });

  it("maps mixed/number enums to a union of literals", () => {
    expect(zod({ enum: [1, 2, 3] })).toBe(
      "z.union([z.literal(1), z.literal(2), z.literal(3)])",
    );
  });

  it("maps const to a literal", () => {
    expect(zod({ const: "fixed" })).toBe('z.literal("fixed")');
  });
});

describe("schemaToZod — objects", () => {
  it("marks non-required properties optional", () => {
    expect(
      zod({
        type: "object",
        properties: { a: { type: "string" }, b: { type: "string" } },
        required: ["a"],
      }),
    ).toBe("z.object({ a: z.string(), b: z.string().optional() })");
  });

  it("maps additionalProperties variants", () => {
    expect(zod({ type: "object", properties: {}, additionalProperties: false })).toBe(
      "z.object({  }).strict()",
    );
    expect(zod({ type: "object", properties: {}, additionalProperties: true })).toBe(
      "z.object({  }).catchall(z.unknown())",
    );
    expect(
      zod({
        type: "object",
        properties: { a: { type: "string" } },
        required: ["a"],
        additionalProperties: { type: "number" },
      }),
    ).toBe("z.object({ a: z.string() }).catchall(z.number())");
  });

  it("maps a property-less object with a schema additionalProperties to a record", () => {
    expect(zod({ type: "object", additionalProperties: { type: "number" } })).toBe(
      "z.record(z.string(), z.number())",
    );
  });

  it("quotes keys that are not bare identifiers", () => {
    expect(
      zod({ type: "object", properties: { "x-id": { type: "string" } }, required: ["x-id"] }),
    ).toBe('z.object({ "x-id": z.string() })');
  });
});

describe("schemaToZod — arrays", () => {
  it("maps items and min/max items", () => {
    expect(zod({ type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 })).toBe(
      "z.array(z.string()).min(1).max(3)",
    );
  });
});

describe("schemaToZod — composition", () => {
  it("maps allOf to an intersection chain", () => {
    const out = zod({
      allOf: [
        { type: "object", properties: {} },
        { type: "object", properties: {} },
      ],
    });
    expect(out).toContain(".and(");
  });

  it("maps oneOf/anyOf to a union", () => {
    expect(zod({ oneOf: [{ type: "string" }, { type: "number" }] })).toBe(
      "z.union([z.string(), z.number()])",
    );
  });

  it("uses discriminatedUnion for inline object members", () => {
    const out = zod({
      oneOf: [
        { type: "object", properties: { kind: { const: "a" } } },
        { type: "object", properties: { kind: { const: "b" } } },
      ],
      discriminator: { propertyName: "kind" },
    });
    expect(out).toContain('z.discriminatedUnion("kind", [');
  });

  it("falls back to a union when discriminated members are $refs", () => {
    const out = zod({
      oneOf: [{ $ref: "#/components/schemas/A" }, { $ref: "#/components/schemas/B" }],
      discriminator: { propertyName: "kind" },
    });
    expect(out).toContain("z.union([");
    expect(out).not.toContain("z.discriminatedUnion");
  });
});

describe("schemaToZod — $ref", () => {
  it("emits a lazy reference and never follows it", () => {
    expect(zod({ $ref: "#/components/schemas/Post" })).toBe("z.lazy(() => PostSchema)");
  });

  it("emits a referencing object property as a getter (recursion-safe)", () => {
    // A direct $ref property → a getter with the lazy wrapper unwrapped.
    expect(
      zod({
        type: "object",
        properties: { author: { $ref: "#/components/schemas/Author" } },
        required: ["author"],
      }),
    ).toBe("z.object({ get author() { return AuthorSchema; } })");
    // An array-of-$ref property → the whole expression deferred by the getter.
    expect(
      zod({
        type: "object",
        properties: { posts: { type: "array", items: { $ref: "#/components/schemas/Post" } } },
      }),
    ).toBe("z.object({ get posts() { return z.array(PostSchema).optional(); } })");
  });

  it("leaves non-referencing object properties as plain entries", () => {
    expect(
      zod({ type: "object", properties: { name: { type: "string" } }, required: ["name"] }),
    ).toBe("z.object({ name: z.string() })");
  });
});

describe("emitParamsObject", () => {
  const param = (over: Partial<ParamPlan>): ParamPlan => ({
    name: "x",
    identifier: "x",
    location: "query",
    required: false,
    schema: { type: "string" },
    ...over,
  });

  it("makes required path params non-optional and coerces", () => {
    expect(
      emitParamsObject(
        [param({ name: "id", identifier: "id", location: "path", required: true })],
        coerce,
      ),
    ).toBe("z.object({ id: z.coerce.string() })");
  });

  it("makes non-required query params optional", () => {
    expect(
      emitParamsObject(
        [param({ name: "limit", identifier: "limit", schema: { type: "integer" } })],
        coerce,
      ),
    ).toBe("z.object({ limit: z.coerce.number().int().optional() })");
  });

  it("quotes non-identifier param keys", () => {
    expect(
      emitParamsObject([param({ name: "X-Token", identifier: "X-Token", required: true })], coerce),
    ).toBe('z.object({ "X-Token": z.coerce.string() })');
  });

  it("emits an empty object for no params", () => {
    expect(emitParamsObject([], coerce)).toBe("z.object({  })");
  });
});

describe("emitBodySchema", () => {
  it("emits the JSON body schema", () => {
    expect(
      emitBodySchema(
        { contentType: "application/json", required: true, schema: { $ref: "#/components/schemas/Post" }, isNonJson: false },
        body,
      ),
    ).toBe("z.lazy(() => PostSchema)");
  });

  it("emits FormData for a non-JSON body", () => {
    expect(
      emitBodySchema(
        { contentType: "multipart/form-data", required: true, schema: { type: "object" }, isNonJson: true },
        body,
      ),
    ).toBe("z.instanceof(FormData)");
  });

  it("emits z.unknown() for a missing body", () => {
    expect(emitBodySchema(undefined, body)).toBe("z.unknown()");
  });
});

describe("buildComponentSchemas — from the bundled edge-cases fixture", () => {
  it("emits consts in sorted order and breaks the Author↔Post cycle with getters", async () => {
    const { bundled } = await loadSpec(join(fixturesDir, "edge-cases.yaml"));
    const components = buildComponentSchemas(bundled);
    const out = components.emitConstsBlock();

    // Sorted key order: Author, Post, PostList.
    const order = ["AuthorSchema", "PostSchema", "PostListSchema"].map((id) =>
      out.indexOf(`export const ${id} =`),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order[0]).toBeLessThan(order[1]!);
    expect(order[1]).toBeLessThan(order[2]!);

    // Cross-const references inside object properties are emitted as getters
    // (not `key: z.lazy(...)`), so the recursive consts typecheck under strict TS
    // without an explicit annotation. The getter defers evaluation, so the lazy
    // wrapper is unwrapped to a direct reference.
    expect(out).toContain("get posts() { return z.array(PostSchema).optional(); }"); // Author.posts
    expect(out).toContain("get author() { return AuthorSchema.optional(); }"); // Post.author
    expect(out).not.toContain("z.lazy(");

    // Format + both nullable spellings survive normalization.
    expect(out).toContain("z.uuid()"); // Post.id (format: uuid)
    expect(out).toContain("z.string().nullable()"); // Post.summary (3.1) + nextCursor (3.0)
  });

  it("produces byte-identical output across runs (deterministic)", async () => {
    const { bundled } = await loadSpec(join(fixturesDir, "edge-cases.yaml"));
    const a = buildComponentSchemas(bundled).emitConstsBlock();
    const b = buildComponentSchemas(bundled).emitConstsBlock();
    expect(a).toBe(b);
  });

  it("throws on an unresolvable reference", async () => {
    const { bundled } = await loadSpec(join(fixturesDir, "edge-cases.yaml"));
    const { resolveRef } = buildComponentSchemas(bundled);
    expect(() => resolveRef("#/components/schemas/Missing")).toThrow(/Cannot resolve/);
  });
});
