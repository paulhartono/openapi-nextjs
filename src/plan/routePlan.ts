import type {
  HttpMethod,
  MediaTypeObject,
  OpenAPIDocument,
  OperationObject,
  ParameterLocation,
  ParameterObject,
  PathItemObject,
  ReferenceObject,
  RequestBodyObject,
  ResponseObject,
  SchemaObject,
} from "../spec/types.js";
import { HTTP_METHODS, isReferenceObject } from "../spec/types.js";
import {
  artifactName,
  NameRegistry,
  operationBaseName,
} from "./naming.js";

/**
 * Turns an OpenAPI document into a flat list of {@link RoutePlan}s — one per
 * path — that the emitters consume. The plan is purely structural: it records
 * filesystem layout, grouped HTTP methods, params split by location, the chosen
 * request body, and the response selected for mocking. Emitters never re-walk
 * the raw document.
 *
 * Operates on the *dereferenced* document (parameters resolved); body/response
 * schemas are carried through as-is (they may be `$ref`s in the bundled view).
 */

/** Order in which HTTP methods are emitted — fixed for deterministic output. */
const METHOD_ORDER: readonly HttpMethod[] = HTTP_METHODS;

/** Request body content types we know how to wire up, in priority order. */
const BODY_CONTENT_PRIORITY = [
  "application/json",
  "application/*+json",
  "multipart/form-data",
] as const;

export interface ParamPlan {
  name: string;
  /** A valid Next.js dynamic-segment / destructuring identifier. */
  identifier: string;
  location: ParameterLocation;
  required: boolean;
  schema: SchemaObject | ReferenceObject | undefined;
}

export interface BodyPlan {
  contentType: string;
  required: boolean;
  schema: SchemaObject | ReferenceObject | undefined;
  /** True when the chosen content type is not JSON (multipart, etc.). */
  isNonJson: boolean;
}

export interface ResponsePlan {
  status: string;
  isEmpty: boolean;
  contentType: string | undefined;
  schema: SchemaObject | ReferenceObject | undefined;
  media: MediaTypeObject | undefined;
}

export interface MethodPlan {
  httpMethod: HttpMethod;
  /** The exported handler name, e.g. `GET`, `POST`. */
  handlerName: string;
  /** PascalCase base for type/schema names. */
  baseName: string;
  pathParams: ParamPlan[];
  queryParams: ParamPlan[];
  headerParams: ParamPlan[];
  cookieParams: ParamPlan[];
  requestBody: BodyPlan | undefined;
  /** All responses, plus the one chosen for mocking. */
  responses: ResponsePlan[];
  mockResponse: ResponsePlan | undefined;
}

export interface RoutePlan {
  /** OpenAPI path template, e.g. `/users/{userId}/posts`. */
  oasPath: string;
  /** fs dir relative to the route root, e.g. `users/[userId]/posts` (`""` for root). */
  routeDir: string;
  /** Names of dynamic params in this path, in segment order. */
  dynamicParams: string[];
  methods: MethodPlan[];
}

/** Build the full set of route plans from a document. */
export function buildRoutePlans(doc: OpenAPIDocument): RoutePlan[] {
  const registry = new NameRegistry();
  const paths = doc.paths ?? {};
  const plans: RoutePlan[] = [];

  // Deterministic order: sort path keys, fixed method order within each path.
  for (const oasPath of Object.keys(paths).sort()) {
    const item = paths[oasPath];
    if (item === undefined) continue;
    plans.push(buildRoutePlan(oasPath, item, registry));
  }

  return plans;
}

function buildRoutePlan(
  oasPath: string,
  item: PathItemObject,
  registry: NameRegistry,
): RoutePlan {
  const { routeDir, dynamicParams } = mapPathToDir(oasPath);
  const sharedParams = resolveParameters(item.parameters);
  const methods: MethodPlan[] = [];

  for (const method of METHOD_ORDER) {
    const operation = item[method];
    if (operation === undefined) continue;
    methods.push(buildMethodPlan(method, oasPath, operation, sharedParams, registry));
  }

  return { oasPath, routeDir, dynamicParams, methods };
}

/**
 * Map an OpenAPI path template to a Next.js App Router directory.
 * `/users/{userId}/posts` → `users/[userId]/posts`. The root path `/` → `""`.
 * Throws if a dynamic param name repeats within the path (Next.js disallows it).
 */
export function mapPathToDir(oasPath: string): {
  routeDir: string;
  dynamicParams: string[];
} {
  const segments = oasPath.split("/").filter((s) => s.length > 0);
  const dynamicParams: string[] = [];
  const seen = new Set<string>();
  const dirSegments: string[] = [];

  for (const segment of segments) {
    const match = /^\{(.+)\}$/.exec(segment);
    if (match) {
      const name = match[1] ?? "";
      if (seen.has(name)) {
        throw new Error(
          `Duplicate path parameter "${name}" in path "${oasPath}" — ` +
            `Next.js requires unique dynamic segment names within a route.`,
        );
      }
      seen.add(name);
      dynamicParams.push(name);
      dirSegments.push(`[${name}]`);
    } else {
      dirSegments.push(sanitizeLiteralSegment(segment));
    }
  }

  return { routeDir: dirSegments.join("/"), dynamicParams };
}

/** Keep literal path segments filesystem- and route-safe. */
function sanitizeLiteralSegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9._~-]/g, "-");
}

function buildMethodPlan(
  method: HttpMethod,
  oasPath: string,
  operation: OperationObject,
  sharedParams: ParameterObject[],
  registry: NameRegistry,
): MethodPlan {
  const base = registry.claim(
    operationBaseName(method, oasPath, operation.operationId),
  );
  // Register the artifact names so component schemas can detect collisions later.
  for (const artifact of ["Params", "Query", "Headers", "Cookies", "Body", "Response"] as const) {
    registry.claim(artifactName(base, artifact));
  }

  const params = mergeParameters(sharedParams, resolveParameters(operation.parameters));
  const requestBody = pickRequestBody(operation.requestBody);
  const responses = collectResponses(operation.responses);

  return {
    httpMethod: method,
    handlerName: method.toUpperCase(),
    baseName: base,
    pathParams: params.filter((p) => p.location === "path"),
    queryParams: params.filter((p) => p.location === "query"),
    headerParams: params.filter((p) => p.location === "header"),
    cookieParams: params.filter((p) => p.location === "cookie"),
    requestBody,
    responses,
    mockResponse: pickMockResponse(responses),
  };
}

/** Drop `$ref` parameters (dereferenced docs have none) and map to {@link ParamPlan}. */
function resolveParameters(
  params: readonly (ParameterObject | ReferenceObject)[] | undefined,
): ParameterObject[] {
  if (params === undefined) return [];
  return params.filter((p): p is ParameterObject => !isReferenceObject(p));
}

/**
 * Merge shared (path-item) params with operation params. Operation params win
 * on a `(name, in)` clash, per the OpenAPI spec.
 */
function mergeParameters(
  shared: ParameterObject[],
  own: ParameterObject[],
): ParamPlan[] {
  const byKey = new Map<string, ParameterObject>();
  for (const p of shared) byKey.set(`${p.in}:${p.name}`, p);
  for (const p of own) byKey.set(`${p.in}:${p.name}`, p);

  return [...byKey.values()].map((p) => ({
    name: p.name,
    identifier: toParamIdentifier(p.name),
    location: p.in,
    // Path params are always required per the spec.
    required: p.in === "path" ? true : (p.required ?? false),
    schema: p.schema,
  }));
}

/** Param names become object keys / destructuring targets; keep them safe. */
function toParamIdentifier(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_$]/g, "_");
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

/** Choose one request body content type by priority; flag non-JSON choices. */
function pickRequestBody(
  body: RequestBodyObject | ReferenceObject | undefined,
): BodyPlan | undefined {
  if (body === undefined || isReferenceObject(body)) return undefined;
  const content = body.content;
  if (content === undefined) return undefined;

  const available = Object.keys(content);
  const chosen =
    BODY_CONTENT_PRIORITY.find((ct) => available.includes(ct)) ?? available[0];
  if (chosen === undefined) return undefined;

  return {
    contentType: chosen,
    required: body.required ?? false,
    schema: content[chosen]?.schema,
    isNonJson: !chosen.includes("json"),
  };
}

function collectResponses(
  responses: Readonly<Record<string, ResponseObject | ReferenceObject>> | undefined,
): ResponsePlan[] {
  if (responses === undefined) return [];

  return Object.keys(responses)
    .sort()
    .map((status) => {
      const response = responses[status];
      if (response === undefined || isReferenceObject(response)) {
        return { status, isEmpty: true, contentType: undefined, schema: undefined, media: undefined };
      }
      const content = response.content ?? {};
      const contentType =
        "application/json" in content ? "application/json" : Object.keys(content)[0];
      const media = contentType === undefined ? undefined : content[contentType];
      return {
        status,
        isEmpty: media?.schema === undefined,
        contentType,
        schema: media?.schema,
        media,
      };
    });
}

/** Pick the lowest 2xx response for mocking; undefined if there is none. */
function pickMockResponse(responses: ResponsePlan[]): ResponsePlan | undefined {
  const success = responses
    .filter((r) => /^2\d\d$/.test(r.status))
    .sort((a, b) => a.status.localeCompare(b.status));
  return success[0];
}
