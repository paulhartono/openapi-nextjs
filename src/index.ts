/**
 * Public library API for `openapi-nextjs`.
 *
 * `generate()` is the high-level entry point (load → plan → emit → write); the
 * individual stages are re-exported below so they can also be composed directly.
 */

export type { GenerateResult } from "./generate.js";
export { generate } from "./generate.js";

export type { GenerateOptions } from "./config.js";
export { DEFAULT_ROUTE_DIR, DEFAULT_TYPES_DIR, resolveOptions } from "./config.js";

export type { LoadedSpec } from "./spec/load.js";
export { loadSpec } from "./spec/load.js";

export type {
  BodyPlan,
  MethodPlan,
  ParamPlan,
  ResponsePlan,
  RoutePlan,
} from "./plan/routePlan.js";
export { buildRoutePlans, mapPathToDir } from "./plan/routePlan.js";

export type {
  HttpMethod,
  OpenAPIDocument,
  ParameterLocation,
  SchemaObject,
} from "./spec/types.js";

export type {
  ComponentSchemas,
  RefResolver,
  ZodEmitContext,
  ZodMode,
} from "./emit/zod.js";
export {
  buildComponentSchemas,
  emitBodySchema,
  emitParamsObject,
  schemaToZod,
} from "./emit/zod.js";

export { emitTypes } from "./emit/types.js";

export type { RouteEmitContext } from "./emit/route.js";
export { emitRoute } from "./emit/route.js";

export type { GeneratedEmitContext } from "./emit/generated.js";
export { emitGenerated } from "./emit/generated.js";

export type { WritePolicy, WriteSummary, WriteTask } from "./fs/writer.js";
export { GENERATED_BANNER, writeAll } from "./fs/writer.js";
