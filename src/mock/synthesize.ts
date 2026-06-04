/**
 * Mock value synthesizer.
 *
 * Turns an OpenAPI schema into a plausible JS value to return as a mock
 * response. Everything here is **pure**: functions return plain JS values and
 * never touch the filesystem or emit strings. A later emitter `JSON.stringify`s
 * the result into `<name>.generated.ts`.
 *
 * Design contract (see CLAUDE.md → "Critical design rules"):
 *
 * - Operates on the **dereferenced** document — concrete schemas, no `$ref`s to
 *   resolve. The narrowed types still permit `ReferenceObject`, so we tolerate
 *   one defensively (returns `null`).
 * - **Example-first**: a schema/media `example` (or first `examples` entry) is
 *   returned verbatim before any synthesis.
 * - **Cycle + depth guarded**: an identity `Set` of schemas on the current
 *   descent path breaks circular schemas (`Post → Author → Post`); a `maxDepth`
 *   backstop guards pathological acyclic schemas. The format → value mapping
 *   tracks the formats the zod emitter recognizes so mocks and validators agree.
 */

import type {
  MediaTypeObject,
  ReferenceObject,
  SchemaObject,
} from "../spec/types.js";
import { isReferenceObject } from "../spec/types.js";

/** Tunables for {@link synthesizeMock} / {@link synthesizeFromSchema}. */
export interface SynthesizeOptions {
  /** Descent budget before a node is truncated to a "stop" value. */
  maxDepth?: number;
}

const DEFAULT_MAX_DEPTH = 8;
/** Most array fills we emit, even when `minItems` asks for more. */
const MAX_ARRAY_FILL = 3;

/** State threaded through the recursive walk (not part of the public API). */
interface Walk {
  /** Schemas on the current descent path — identity cycle guard. */
  path: Set<SchemaObject>;
  /** Remaining descent budget. */
  depth: number;
}

/**
 * Build a mock value for a media object's schema, example-first. Media-level
 * examples take precedence over schema synthesis.
 */
export function synthesizeMock(
  media: MediaTypeObject | undefined,
  options?: SynthesizeOptions,
): unknown {
  if (media === undefined) return null;

  const fromExample = mediaExample(media);
  if (fromExample !== NO_EXAMPLE) return fromExample;

  return synthesizeFromSchema(media.schema, options);
}

/** Build a mock value from a bare schema, example-first then schema-fallback. */
export function synthesizeFromSchema(
  schema: SchemaObject | ReferenceObject | undefined,
  options?: SynthesizeOptions,
): unknown {
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
  return walk(schema, { path: new Set(), depth: maxDepth });
}

/** Sentinel distinguishing "no example present" from an example of `undefined`. */
const NO_EXAMPLE = Symbol("no-example");

/** Pull a media-level example, or {@link NO_EXAMPLE} if there is none. */
function mediaExample(media: MediaTypeObject): unknown {
  if ("example" in media) return media.example;
  const examples = media.examples;
  if (examples !== undefined) {
    for (const entry of Object.values(examples)) {
      if (!isReferenceObject(entry) && "value" in entry) {
        return entry.value;
      }
    }
  }
  return NO_EXAMPLE;
}

/** Pull a schema-level example, or {@link NO_EXAMPLE} if there is none. */
function schemaExample(schema: SchemaObject): unknown {
  if ("example" in schema) return schema.example;
  if (schema.examples !== undefined && schema.examples.length > 0) {
    return schema.examples[0];
  }
  return NO_EXAMPLE;
}

/** The recursive worker. Returns a "stop" value on cycle or depth exhaustion. */
function walk(
  schema: SchemaObject | ReferenceObject | undefined,
  state: Walk,
): unknown {
  if (schema === undefined) return null;
  // Dereferenced docs carry no $refs; a stray one is not something we can mock.
  if (isReferenceObject(schema)) return null;

  // Example-first: a present example short-circuits all synthesis.
  const example = schemaExample(schema);
  if (example !== NO_EXAMPLE) return example;

  // Cycle / depth backstop: stop with a value valid for the *parent* — but still
  // satisfying this schema's own required shape, so the mock typechecks against
  // the generated types (an empty `{}` would violate required properties).
  if (state.path.has(schema) || state.depth <= 0) {
    return stopValue(schema);
  }

  if (schema.const !== undefined) return schema.const;

  const enumValue = firstEnum(schema);
  if (enumValue !== NO_EXAMPLE) return enumValue;

  const composed = composition(schema, state);
  if (composed !== NO_COMPOSITION) return composed;

  switch (schema.type) {
    case "object":
      return objectValue(schema, state);
    case "array":
      return arrayValue(schema, state);
    case "string":
      return stringValue(schema);
    case "integer":
    case "number":
      return numberValue(schema);
    case "boolean":
      return true;
    case "null":
      return null;
    default:
      // No usable type (or `null`-only after normalization) → null.
      return null;
  }
}

/**
 * A value that keeps the *parent* node valid when we cannot descend further.
 * Objects still emit their **required** properties (filled minimally) so the mock
 * satisfies the generated types; arrays and scalars collapse to empty/null, which
 * is always type-valid for the parent slot.
 */
function stopValue(schema: SchemaObject): unknown {
  switch (schema.type) {
    case "array":
      return [];
    case "object":
      return requiredShell(schema);
    default:
      return null;
  }
}

/** Hard cap on required-shell recursion; guards required-object cycles. */
const MAX_SHELL_DEPTH = 4;

/**
 * The minimal object satisfying a schema's `required` list, without descending
 * into the main synthesis walk. Each required property is filled with a leaf/stop
 * value for its own type, and required object properties recurse up to
 * {@link MAX_SHELL_DEPTH} — beyond which an empty `{}` is emitted. This guarantees
 * termination (even for required-object cycles), which is what makes it safe to
 * call from the cycle/depth backstop.
 */
function requiredShell(schema: SchemaObject, depth = MAX_SHELL_DEPTH): Record<string, unknown> {
  const properties = schema.properties;
  const required = schema.required ?? [];
  const result: Record<string, unknown> = {};
  if (properties === undefined) return result;
  for (const key of required) {
    const prop = properties[key];
    if (prop === undefined || isReferenceObject(prop)) continue;
    result[key] = leafValue(prop, depth);
  }
  return result;
}

/** A bounded, non-walk value for a single property used to fill a required shell. */
function leafValue(schema: SchemaObject, depth: number): unknown {
  if (schema.const !== undefined) return schema.const;
  const enumValue = firstEnum(schema);
  if (enumValue !== NO_EXAMPLE) return enumValue;
  switch (schema.type) {
    case "string":
      return stringValue(schema);
    case "integer":
    case "number":
      return numberValue(schema);
    case "boolean":
      return true;
    case "array":
      return [];
    case "object":
      // A required object property: recurse into its own required shell until the
      // depth cap, then collapse to `{}`. Each step strips to a smaller required
      // set and bottoms out at leaves, so required-object cycles still terminate.
      return depth <= 0 ? {} : requiredShell(schema, depth - 1);
    default:
      return null;
  }
}

/** First non-null enum member, or {@link NO_EXAMPLE} if there is no enum. */
function firstEnum(schema: SchemaObject): unknown {
  const values = schema.enum;
  if (values === undefined || values.length === 0) return NO_EXAMPLE;
  const nonNull = values.filter((v) => v !== null);
  if (nonNull.length > 0) return nonNull[0];
  return null;
}

const NO_COMPOSITION = Symbol("no-composition");

/**
 * `allOf` → shallow-merge synthesized object members. `oneOf`/`anyOf` →
 * synthesize the first member. Returns {@link NO_COMPOSITION} when none apply.
 */
function composition(schema: SchemaObject, state: Walk): unknown {
  if (schema.allOf !== undefined && schema.allOf.length > 0) {
    const child = descend(schema, state);
    const merged: Record<string, unknown> = {};
    for (const member of schema.allOf) {
      const value = walk(member, child);
      if (isPlainObject(value)) Object.assign(merged, value);
    }
    return merged;
  }

  const union = schema.oneOf ?? schema.anyOf;
  if (union !== undefined && union.length > 0) {
    return walk(union[0], descend(schema, state));
  }

  return NO_COMPOSITION;
}

function objectValue(schema: SchemaObject, state: Walk): unknown {
  const properties = schema.properties;
  const child = descend(schema, state);

  // No declared properties + a schema `additionalProperties` → an empty record
  // is a safe, valid mock.
  if (properties === undefined || Object.keys(properties).length === 0) {
    return {};
  }

  const stopping = state.depth <= 1;
  const required = new Set(schema.required ?? []);
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(properties)) {
    // When the next descent would bottom out, keep only required props.
    if (stopping && !required.has(key)) continue;
    result[key] = walk(properties[key], child);
  }
  return result;
}

function arrayValue(schema: SchemaObject, state: Walk): unknown {
  if (schema.items === undefined) return [];
  const item = walk(schema.items, descend(schema, state));
  const count = Math.min(Math.max(schema.minItems ?? 1, 1), MAX_ARRAY_FILL);
  return Array.from({ length: count }, () => item);
}

/** Format-aware string sample; tracks the formats the zod emitter recognizes. */
function stringValue(schema: SchemaObject): string {
  let value: string;
  switch (schema.format) {
    case "uuid":
      value = "00000000-0000-0000-0000-000000000000";
      break;
    case "email":
      value = "user@example.com";
      break;
    case "uri":
    case "url":
      value = "https://example.com";
      break;
    case "date-time":
      value = "1970-01-01T00:00:00Z";
      break;
    case "date":
      value = "1970-01-01";
      break;
    default:
      value = "string";
  }
  if (schema.minLength !== undefined && value.length < schema.minLength) {
    value = value.padEnd(schema.minLength, "x");
  }
  return value;
}

function numberValue(schema: SchemaObject): number {
  if (typeof schema.minimum === "number") return schema.minimum;
  return 0;
}

/** A fresh walk state one level deeper, with `schema` added to the path. */
function descend(schema: SchemaObject, state: Walk): Walk {
  const path = new Set(state.path);
  path.add(schema);
  return { path, depth: state.depth - 1 };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
