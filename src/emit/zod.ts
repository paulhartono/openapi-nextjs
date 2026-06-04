/**
 * zod source emitter.
 *
 * Turns OpenAPI schemas into **zod 4** source strings for runtime validation.
 * Everything here is **pure**: functions return TS expression/statement strings
 * and never touch the filesystem. Formatting (prettier) happens later in
 * `fs/writer.ts`, so output is compact-but-valid TS — snapshot-stable once a
 * formatter runs over the assembled files.
 *
 * Design contract (see CLAUDE.md → "Critical design rules"):
 *
 * - The emitter consumes the **bundled** document, which preserves internal
 *   `$ref`s. Each component schema is emitted **once** as a named const; every
 *   `$ref` becomes a reference to that const. The emitter **never recurses
 *   through a `$ref`** — it emits `z.lazy(() => FooSchema)` and stops. That is
 *   what breaks circular `$ref`s with no cycle guard in this module.
 * - Generated code imports zod from the *consumer's* project (zod is a peer
 *   dependency), so we emit **zod 4 syntax** (`z.uuid()`, `z.email()`,
 *   `z.iso.datetime()`, `z.record(key, value)`, …).
 * - **Coerce mode** is used for params (which arrive as strings) and **body
 *   mode** for JSON bodies. They differ only at primitive leaves.
 */

import type { BodyPlan, ParamPlan } from "../plan/routePlan.js";
import { NameRegistry } from "../plan/naming.js";
import type {
  OpenAPIDocument,
  ReferenceObject,
  SchemaObject,
} from "../spec/types.js";
import { isReferenceObject } from "../spec/types.js";
import { isValidIdentifier } from "../util/ident.js";

/** Whether primitive leaves are wrapped in `z.coerce` (params) or not (bodies). */
export type ZodMode = "body" | "coerce";

/** Maps a `#/components/schemas/Foo` pointer to its emitted const identifier. */
export type RefResolver = (ref: string) => string;

/** Everything the recursive walk needs that is not the schema itself. */
export interface ZodEmitContext {
  mode: ZodMode;
  resolveRef: RefResolver;
}

/** The set of component schemas, emitted once as named consts. */
export interface ComponentSchemas {
  /** Resolve a `#/components/schemas/Foo` pointer to its const identifier. */
  resolveRef: RefResolver;
  /** `export const FooSchema = …;` lines in sorted key order, joined by `\n`. */
  emitConstsBlock(): string;
  /** The registry the names were claimed against (shared with later emitters). */
  registry: NameRegistry;
}

const COMPONENT_PREFIX = "#/components/schemas/";

/** Clone a context back into body mode (used when descending past a leaf). */
function withBodyMode(ctx: ZodEmitContext): ZodEmitContext {
  return ctx.mode === "body" ? ctx : { ...ctx, mode: "body" };
}

/** True for the scalar types whose leaves are coerced in coerce mode. */
function isPrimitiveType(type: SchemaObject["type"]): boolean {
  return (
    type === "string" || type === "number" || type === "integer" || type === "boolean"
  );
}

/** A JSON value as a TS literal (used for `const`, `default`, enum members). */
function jsonLiteral(value: unknown): string {
  return JSON.stringify(value);
}

/** A `pattern` string as a regex literal, escaping the delimiter. */
function regexLiteral(pattern: string): string {
  return `/${pattern.replace(/\\/g, "\\\\").replace(/\//g, "\\/")}/`;
}

/** Quote an object key only when it is not a bare identifier. */
function objectKey(name: string): string {
  return isValidIdentifier(name) ? name : JSON.stringify(name);
}

/** True if a zod expression contains a `z.lazy(() => …)` reference to a const. */
function containsLazyRef(expr: string): boolean {
  return expr.includes("z.lazy(() => ");
}

/**
 * Strip the `z.lazy(() => X)` wrapper(s) from an expression, leaving direct const
 * references (`X`). Used inside object-property getters, where the getter itself
 * provides the deferral so the lazy wrapper is redundant — and where the direct
 * reference is what lets TypeScript infer the recursive type. Only the exact
 * `z.lazy(() => <identifier-or-member>)` shape the ref emitter produces is matched.
 */
function unwrapLazy(expr: string): string {
  return expr.replace(/z\.lazy\(\(\) => ([\w.]+)\)/g, "$1");
}

/**
 * Emit a single schema as a zod expression (no trailing semicolon). A `$ref` is
 * emitted as a lazy reference and never followed — that is the cycle-breaker.
 */
export function schemaToZod(
  schema: SchemaObject | ReferenceObject | undefined,
  ctx: ZodEmitContext,
): string {
  if (schema === undefined) return "z.unknown()";
  if (isReferenceObject(schema)) {
    return `z.lazy(() => ${ctx.resolveRef(schema.$ref)})`;
  }

  const base = baseExpression(schema, ctx);
  return applyModifiers(base, schema);
}

/** The core expression before `.nullable()` / `.default()` modifiers. */
function baseExpression(schema: SchemaObject, ctx: ZodEmitContext): string {
  const composed = compositionExpression(schema, ctx);
  if (composed !== undefined) return composed;

  if (schema.const !== undefined) return `z.literal(${jsonLiteral(schema.const)})`;
  const enumExpr = enumExpression(schema);
  if (enumExpr !== undefined) return enumExpr;

  switch (schema.type) {
    case "string":
      return stringExpression(schema, ctx);
    case "number":
    case "integer":
      return numberExpression(schema, ctx);
    case "boolean":
      return booleanExpression(ctx);
    case "object":
      return objectExpression(schema, ctx);
    case "array":
      return arrayExpression(schema, ctx);
    default:
      return "z.unknown()";
  }
}

/** `allOf` → intersection chain, `oneOf`/`anyOf` → union (or discriminated union). */
function compositionExpression(
  schema: SchemaObject,
  ctx: ZodEmitContext,
): string | undefined {
  const member = withBodyMode(ctx);

  if (schema.allOf !== undefined && schema.allOf.length > 0) {
    const parts = schema.allOf.map((s) => schemaToZod(s, member));
    return parts.reduce((acc, part) => `${acc}.and(${part})`);
  }

  const union = schema.oneOf ?? schema.anyOf;
  if (union !== undefined && union.length > 0) {
    if (union.length === 1) return schemaToZod(union[0], member);

    const parts = union.map((s) => schemaToZod(s, member));
    const propertyName = schema.discriminator?.propertyName;
    // discriminatedUnion requires concrete object members; lazy ($ref) members
    // can throw, so fall back to a plain union when any member is a $ref.
    const allInlineObjects = union.every(
      (s) => !isReferenceObject(s) && s.type === "object",
    );
    if (propertyName !== undefined && allInlineObjects) {
      return `z.discriminatedUnion(${jsonLiteral(propertyName)}, [${parts.join(", ")}])`;
    }
    return `z.union([${parts.join(", ")}])`;
  }

  return undefined;
}

/** `enum` → `z.enum`, a union of literals, or a single literal. */
function enumExpression(schema: SchemaObject): string | undefined {
  const values = schema.enum;
  if (values === undefined || values.length === 0) return undefined;

  const nonNull = values.filter((v) => v !== null);
  if (nonNull.length === 1) return `z.literal(${jsonLiteral(nonNull[0])})`;

  if (nonNull.every((v) => typeof v === "string")) {
    return `z.enum([${nonNull.map((v) => jsonLiteral(v)).join(", ")}])`;
  }
  return `z.union([${nonNull.map((v) => `z.literal(${jsonLiteral(v)})`).join(", ")}])`;
}

function stringExpression(schema: SchemaObject, ctx: ZodEmitContext): string {
  // Coerce mode never applies a format helper: params are plain strings.
  let expr = formatExpression(schema, ctx);

  if (schema.minLength !== undefined) expr += `.min(${String(schema.minLength)})`;
  if (schema.maxLength !== undefined) expr += `.max(${String(schema.maxLength)})`;
  if (schema.pattern !== undefined) expr += `.regex(${regexLiteral(schema.pattern)})`;
  return expr;
}

/** Map a string `format` to the zod 4 helper, ignoring unknown formats. */
function formatExpression(schema: SchemaObject, ctx: ZodEmitContext): string {
  if (ctx.mode === "coerce") return "z.coerce.string()";
  switch (schema.format) {
    case "uuid":
      return "z.uuid()";
    case "email":
      return "z.email()";
    case "uri":
    case "url":
      return "z.url()";
    case "date-time":
      return "z.iso.datetime()";
    case "date":
      return "z.iso.date()";
    default:
      return "z.string()";
  }
}

function numberExpression(schema: SchemaObject, ctx: ZodEmitContext): string {
  let expr = ctx.mode === "coerce" ? "z.coerce.number()" : "z.number()";
  if (schema.type === "integer") expr += ".int()";

  // 3.1 spells exclusive bounds as numbers; 3.0 spells them as a boolean flag
  // paired with `minimum`/`maximum`.
  if (typeof schema.exclusiveMinimum === "number") {
    expr += `.gt(${String(schema.exclusiveMinimum)})`;
  } else if (schema.exclusiveMinimum === true && schema.minimum !== undefined) {
    expr += `.gt(${String(schema.minimum)})`;
  } else if (schema.minimum !== undefined) {
    expr += `.min(${String(schema.minimum)})`;
  }

  if (typeof schema.exclusiveMaximum === "number") {
    expr += `.lt(${String(schema.exclusiveMaximum)})`;
  } else if (schema.exclusiveMaximum === true && schema.maximum !== undefined) {
    expr += `.lt(${String(schema.maximum)})`;
  } else if (schema.maximum !== undefined) {
    expr += `.max(${String(schema.maximum)})`;
  }

  return expr;
}

/**
 * Body mode → `z.boolean()`. Coerce mode → an explicit string enum: a plain
 * `z.coerce.boolean()` treats the string `"false"` as truthy, which is wrong.
 */
function booleanExpression(ctx: ZodEmitContext): string {
  return ctx.mode === "coerce"
    ? `z.enum(["true", "false"]).transform((v) => v === "true")`
    : "z.boolean()";
}

function objectExpression(schema: SchemaObject, ctx: ZodEmitContext): string {
  const member = withBodyMode(ctx);
  const properties = schema.properties;
  const required = new Set(schema.required ?? []);

  // No declared properties + a schema `additionalProperties` → a record.
  if (
    (properties === undefined || Object.keys(properties).length === 0) &&
    typeof schema.additionalProperties === "object"
  ) {
    return `z.record(z.string(), ${schemaToZod(schema.additionalProperties, member)})`;
  }

  const entries = Object.keys(properties ?? {}).map((key) => {
    const prop = properties?.[key];
    const value = schemaToZod(prop, member);
    const optional = required.has(key) ? "" : ".optional()";
    // A property whose value references another component const would, as a plain
    // `key: z.lazy(() => X)` entry, force TypeScript to infer the const's type from
    // its own initializer — an implicit-any/circularity error under strict TS. The
    // zod 4 idiom is a getter: the getter body defers evaluation, so the `z.lazy`
    // wrapper is unnecessary and is unwrapped to a direct reference.
    if (containsLazyRef(value)) {
      return `get ${objectKey(key)}() { return ${unwrapLazy(value)}${optional}; }`;
    }
    return `${objectKey(key)}: ${value}${optional}`;
  });

  let expr = `z.object({ ${entries.join(", ")} })`;
  const extra = schema.additionalProperties;
  if (extra === false) {
    expr += ".strict()";
  } else if (extra === true) {
    expr += ".catchall(z.unknown())";
  } else if (typeof extra === "object") {
    expr += `.catchall(${schemaToZod(extra, member)})`;
  }
  return expr;
}

function arrayExpression(schema: SchemaObject, ctx: ZodEmitContext): string {
  // Repeated query params arrive as arrays of strings, so a coerce-mode array
  // of primitives keeps coercion on its items (z.coerce is per-element, never
  // applied to the array itself).
  const itemSchema = schema.items;
  const itemIsPrimitive =
    itemSchema !== undefined &&
    !isReferenceObject(itemSchema) &&
    isPrimitiveType(itemSchema.type);
  const itemCtx = ctx.mode === "coerce" && itemIsPrimitive ? ctx : withBodyMode(ctx);

  let expr = `z.array(${schemaToZod(itemSchema, itemCtx)})`;
  if (schema.minItems !== undefined) expr += `.min(${String(schema.minItems)})`;
  if (schema.maxItems !== undefined) expr += `.max(${String(schema.maxItems)})`;
  return expr;
}

/** Apply `.nullable()` then `.default()` (default last, on the nullable type). */
function applyModifiers(base: string, schema: SchemaObject): string {
  let expr = base;
  if (schema.nullable === true) expr += ".nullable()";
  if (schema.default !== undefined) expr += `.default(${jsonLiteral(schema.default)})`;
  return expr;
}

/**
 * Build the component registry from a **bundled** document's
 * `components.schemas`. Names are claimed against a {@link NameRegistry} (shared
 * with later emitters) so they cannot collide with operation-artifact names.
 */
export function buildComponentSchemas(
  doc: OpenAPIDocument,
  registry: NameRegistry = new NameRegistry(),
): ComponentSchemas {
  const schemas = doc.components?.schemas ?? {};
  const keys = Object.keys(schemas).sort();
  const idByPointer = new Map<string, string>();
  const idByKey = new Map<string, string>();

  for (const key of keys) {
    const id = registry.claim(`${key}Schema`);
    idByPointer.set(`${COMPONENT_PREFIX}${key}`, id);
    idByKey.set(key, id);
  }

  const resolveRef: RefResolver = (ref) => {
    const id = idByPointer.get(ref);
    if (id === undefined) {
      throw new Error(
        `Cannot resolve schema reference "${ref}" — only internal ` +
          `"${COMPONENT_PREFIX}*" references in a bundled document are supported.`,
      );
    }
    return id;
  };

  const emitConstsBlock = (): string =>
    keys
      .map((key) => {
        const id = idByKey.get(key) ?? "";
        const expr = schemaToZod(schemas[key], { mode: "body", resolveRef });
        return `export const ${id} = ${expr};`;
      })
      .join("\n");

  return { resolveRef, emitConstsBlock, registry };
}

/**
 * Emit a `z.object({...})` for a flat parameter list. Keys are the param
 * identifiers; non-required params get `.optional()`. Callers pass `coerce`
 * mode for path/query/header objects.
 */
export function emitParamsObject(
  params: readonly ParamPlan[],
  ctx: ZodEmitContext,
): string {
  const entries = params.map((param) => {
    const value = schemaToZod(param.schema, ctx);
    const optional = param.required ? "" : ".optional()";
    return `${objectKey(param.identifier)}: ${value}${optional}`;
  });
  return `z.object({ ${entries.join(", ")} })`;
}

/**
 * Emit the body schema expression. A non-JSON body (multipart, etc.) is the
 * runtime `FormData` value; a missing schema is `z.unknown()`.
 */
export function emitBodySchema(
  body: BodyPlan | undefined,
  ctx: ZodEmitContext,
): string {
  if (body === undefined) return "z.unknown()";
  if (body.isNonJson) return "z.instanceof(FormData)";
  return schemaToZod(body.schema, withBodyMode(ctx));
}
