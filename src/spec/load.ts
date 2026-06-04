import SwaggerParser from "@apidevtools/swagger-parser";

import type { OpenAPIDocument, SchemaObject } from "./types.js";
import { isReferenceObject } from "./types.js";

/**
 * swagger-parser's parameter type is the loose `openapi-types` `Document`, which
 * we intentionally do not depend on. This alias documents the cast boundary:
 * everything we hand to or receive from the parser is `unknown` to us.
 */
type ParserInput = Parameters<typeof SwaggerParser.dereference>[0];

/**
 * The result of loading a spec: two views of the same document.
 *
 * - {@link LoadedSpec.dereferenced} has every `$ref` inlined (shared object
 *   identity is preserved for cycles). Used by the type generator and the mock
 *   synthesizer, which walk concrete schemas.
 * - {@link LoadedSpec.bundled} keeps internal `$ref`s intact. Used by the zod
 *   emitter so each component is emitted once and referenced by name — this is
 *   what makes circular `$ref`s terminate.
 *
 * See CLAUDE.md → "Critical design rules" for why we keep both.
 */
export interface LoadedSpec {
  dereferenced: OpenAPIDocument;
  bundled: OpenAPIDocument;
}

/**
 * Load an OpenAPI/Swagger document from a file path (YAML or JSON) or from an
 * in-memory object. Produces both a dereferenced and a bundled view, each with
 * 3.0/3.1 nullable spellings normalized.
 *
 * `swagger-parser` mutates the object it is given, so we parse twice from the
 * source rather than sharing one parsed tree between the two views.
 */
export async function loadSpec(source: string | OpenAPIDocument): Promise<LoadedSpec> {
  const dereferenced = (await SwaggerParser.dereference(
    cloneSource(source),
  )) as unknown as OpenAPIDocument;
  const bundled = (await SwaggerParser.bundle(
    cloneSource(source),
  )) as unknown as OpenAPIDocument;

  normalizeDocument(dereferenced);
  normalizeDocument(bundled);

  return { dereferenced, bundled };
}

/**
 * A file path is passed through; an object is deep-cloned to avoid mutation.
 * The return is widened so swagger-parser accepts it — our narrowed
 * {@link OpenAPIDocument} is structurally stricter than its `OpenAPI.Document`.
 */
function cloneSource(source: string | OpenAPIDocument): ParserInput {
  return typeof source === "string"
    ? source
    : (structuredClone(source) as unknown as ParserInput);
}

/**
 * Walk the whole document and normalize every schema in place. Idempotent and
 * cycle-safe (tracks visited objects by identity).
 */
export function normalizeDocument(doc: OpenAPIDocument): void {
  const seen = new WeakSet();
  visit(doc, seen);
}

function visit(value: unknown, seen: WeakSet<object>): void {
  if (typeof value !== "object" || value === null) return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) visit(item, seen);
    return;
  }

  // A schema-like object: normalize its nullable spelling, then recurse.
  const record = value as Record<string, unknown>;
  normalizeSchema(record);
  for (const key of Object.keys(record)) {
    visit(record[key], seen);
  }
}

/**
 * Collapse OpenAPI 3.1's `type: [..., "null"]` and 3.0's `nullable: true` into a
 * single representation: a single `type` plus a boolean `nullable`. Leaves
 * non-schema objects untouched.
 */
export function normalizeSchema(schema: SchemaObject): void {
  if (isReferenceObject(schema)) return;

  const rawType: unknown = (schema as { type?: unknown }).type;

  if (Array.isArray(rawType)) {
    const members = rawType.filter((t): t is string => typeof t === "string");
    const hasNull = members.includes("null");
    const nonNull = members.filter((t) => t !== "null");

    if (hasNull) schema.nullable = true;
    // Take the first non-null type; unions of real types are handled via
    // oneOf/anyOf elsewhere, not via the `type` array.
    const [first] = nonNull;
    if (first !== undefined) {
      schema.type = first as NonNullable<SchemaObject["type"]>;
    } else {
      delete schema.type;
    }
  }

  // 3.1 spells nullable-enum by including `null` in `enum`; reflect that.
  if (Array.isArray(schema.enum) && schema.enum.includes(null)) {
    schema.nullable = true;
  }
}
