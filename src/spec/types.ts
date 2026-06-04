/**
 * Narrowed OpenAPI 3.0 / 3.1 types that this tool relies on.
 *
 * We intentionally model only the subset we consume rather than depending on a
 * loose third-party type package. After {@link normalizeDocument} runs, several
 * 3.0/3.1 spelling differences are collapsed into one shape (see {@link SchemaObject}).
 */

/** HTTP methods that map to Next.js App Router route handlers. */
export const HTTP_METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

/** Where a parameter is located, per the OpenAPI spec. */
export type ParameterLocation = "path" | "query" | "header" | "cookie";

/** The primitive `type` values an OpenAPI schema may declare. */
export type SchemaType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "object"
  | "array"
  | "null";

/**
 * A JSON-pointer reference. Present in a `bundle()`d document (used by the zod
 * emitter to emit each component once) and absent in a `dereference()`d document.
 */
export interface ReferenceObject {
  $ref: string;
}

export function isReferenceObject(value: unknown): value is ReferenceObject {
  return (
    typeof value === "object" &&
    value !== null &&
    "$ref" in value &&
    typeof value.$ref === "string"
  );
}

/**
 * An OpenAPI Schema Object. This is a structural superset that tolerates both
 * 3.0 (`nullable: true`) and 3.1 (`type: ["string", "null"]`) before
 * normalization. After normalization, `nullable` is the single source of truth
 * and `type` is always a single {@link SchemaType} (or absent).
 */
export interface SchemaObject {
  type?: SchemaType;
  /** Only present pre-normalization; collapsed into `type` + `nullable`. */
  format?: string;
  nullable?: boolean;
  enum?: readonly (string | number | boolean | null)[];
  const?: string | number | boolean | null;
  default?: unknown;
  example?: unknown;
  examples?: readonly unknown[];

  // object
  properties?: Readonly<Record<string, SchemaObject | ReferenceObject>>;
  required?: readonly string[];
  additionalProperties?: boolean | SchemaObject | ReferenceObject;

  // array
  items?: SchemaObject | ReferenceObject;
  minItems?: number;
  maxItems?: number;

  // string
  minLength?: number;
  maxLength?: number;
  pattern?: string;

  // number
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number | boolean;
  exclusiveMaximum?: number | boolean;

  // composition
  allOf?: readonly (SchemaObject | ReferenceObject)[];
  oneOf?: readonly (SchemaObject | ReferenceObject)[];
  anyOf?: readonly (SchemaObject | ReferenceObject)[];
  discriminator?: { propertyName: string };

  title?: string;
  description?: string;
}

export interface MediaTypeObject {
  schema?: SchemaObject | ReferenceObject;
  example?: unknown;
  examples?: Readonly<Record<string, { value?: unknown } | ReferenceObject>>;
}

export interface ParameterObject {
  name: string;
  in: ParameterLocation;
  required?: boolean;
  description?: string;
  schema?: SchemaObject | ReferenceObject;
}

export interface RequestBodyObject {
  required?: boolean;
  description?: string;
  content?: Readonly<Record<string, MediaTypeObject>>;
}

export interface ResponseObject {
  description?: string;
  content?: Readonly<Record<string, MediaTypeObject>>;
}

export interface OperationObject {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: readonly (ParameterObject | ReferenceObject)[];
  requestBody?: RequestBodyObject | ReferenceObject;
  responses?: Readonly<Record<string, ResponseObject | ReferenceObject>>;
}

/** A Path Item Object: operations keyed by HTTP method, plus shared parameters. */
export type PathItemObject = {
  parameters?: readonly (ParameterObject | ReferenceObject)[];
} & Partial<Record<HttpMethod, OperationObject>>;

export interface ComponentsObject {
  schemas?: Readonly<Record<string, SchemaObject | ReferenceObject>>;
}

export interface OpenAPIDocument {
  openapi: string;
  info: { title: string; version: string };
  paths?: Readonly<Record<string, PathItemObject>>;
  components?: ComponentsObject;
}
