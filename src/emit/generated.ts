/**
 * `<name>.generated.ts` emitter.
 *
 * Produces the always-overwritten sibling of each `route.ts`: the zod validators
 * for an operation's params/body, the mock-response factories, and the inferred
 * TypeScript types. Like the other emitters this is **pure** — it returns a source
 * string and never touches the filesystem; `fs/writer.ts` formats and writes it.
 *
 * Design contract (see CLAUDE.md → "Critical design rules"):
 *
 * - The file is regenerated on every run and carries the `DO NOT EDIT` banner with
 *   no timestamp, so regeneration is byte-identical.
 * - Component schemas live once in the shared `_schemas.generated.ts`. We import
 *   them as a namespace (`import * as schemas`) and wrap the bundled
 *   {@link RefResolver} so every `$ref` renders as `schemas.<Name>Schema`.
 * - Param/query/header/cookie schemas use **coerce mode** (they arrive as strings);
 *   request bodies use **body mode**.
 * - The zod consts are built from the **bundled** plan (so `$ref`s survive), while
 *   the mock literals come from the **dereferenced** plan (so values are concrete).
 */

import { artifactName } from "../plan/naming.js";
import type { MethodPlan, RoutePlan } from "../plan/routePlan.js";
import { synthesizeMock } from "../mock/synthesize.js";
import type { RefResolver, ZodEmitContext } from "./zod.js";
import { emitBodySchema, emitParamsObject, schemaToZod } from "./zod.js";
import { isReferenceObject } from "../spec/types.js";
import { GENERATED_BANNER } from "../util/banner.js";

export interface GeneratedEmitContext {
  /** Resolves a `#/components/schemas/Foo` pointer to its bare const id (`FooSchema`). */
  resolveRef: RefResolver;
  /** Extensionless specifier for the shared schemas module, e.g. `../../../_schemas.generated`. */
  schemasModule: string;
  /** The matching **dereferenced** plan, used only to synthesize concrete mock values. */
  mockPlan: RoutePlan;
}

/** Emit the `<name>.generated.ts` source for one route plan. */
export function emitGenerated(plan: RoutePlan, ctx: GeneratedEmitContext): string {
  // Component refs resolve to `schemas.<Name>Schema` via the namespace import.
  const nsResolve: RefResolver = (ref) => `schemas.${ctx.resolveRef(ref)}`;
  const coerce: ZodEmitContext = { mode: "coerce", resolveRef: nsResolve };
  const body: ZodEmitContext = { mode: "body", resolveRef: nsResolve };

  const blocks = plan.methods.map((method, index) =>
    emitMethodBlock(method, plan, ctx.mockPlan.methods[index], coerce, body, nsResolve),
  );

  const header = [
    GENERATED_BANNER,
    `import { z } from "zod";`,
    "",
    `import * as schemas from "${ctx.schemasModule}";`,
  ].join("\n");

  return `${header}\n\n${blocks.join("\n\n")}\n`;
}

/** All consts, type re-exports, and the mock factory for a single HTTP method. */
function emitMethodBlock(
  method: MethodPlan,
  plan: RoutePlan,
  mockMethod: MethodPlan | undefined,
  coerce: ZodEmitContext,
  body: ZodEmitContext,
  nsResolve: RefResolver,
): string {
  const lines: string[] = [
    `// ${method.handlerName} ${plan.oasPath} — ${method.baseName}`,
  ];

  const constNames: string[] = [];
  const addParamsConst = (
    artifact: "Params" | "Query" | "Headers" | "Cookies",
    params: MethodPlan["pathParams"],
  ): void => {
    if (params.length === 0) return;
    const name = artifactName(method.baseName, artifact);
    lines.push(`export const ${name} = ${emitParamsObject(params, coerce)};`);
    constNames.push(name);
  };

  addParamsConst("Params", method.pathParams);
  addParamsConst("Query", method.queryParams);
  addParamsConst("Headers", method.headerParams);
  addParamsConst("Cookies", method.cookieParams);

  if (method.requestBody !== undefined) {
    const name = artifactName(method.baseName, "Body");
    lines.push(`export const ${name} = ${emitBodySchema(method.requestBody, body)};`);
    constNames.push(name);
  }

  for (const name of constNames) {
    lines.push(`export type ${name} = z.infer<typeof ${name}>;`);
  }

  emitResponse(method, mockMethod, body, nsResolve, lines);

  return lines.join("\n");
}

/**
 * Emit the response type + mock factory. A `$ref` response infers directly from
 * the shared schema; an inline response gets a local `…Response` const to infer
 * from. A missing or empty (e.g. 204) response yields no type and no factory.
 */
function emitResponse(
  method: MethodPlan,
  mockMethod: MethodPlan | undefined,
  body: ZodEmitContext,
  nsResolve: RefResolver,
  lines: string[],
): void {
  const responseName = artifactName(method.baseName, "Response");
  const mock = method.mockResponse;

  if (mock === undefined || mock.isEmpty || mock.schema === undefined) {
    // No response body to type or mock (no 2xx, or a body-less status like 204).
    return;
  }

  if (isReferenceObject(mock.schema)) {
    lines.push(
      `export type ${responseName} = z.infer<typeof ${nsResolve(mock.schema.$ref)}>;`,
    );
  } else {
    const expr = schemaToZod(mock.schema, body);
    lines.push(`const ${responseName}Schema = ${expr};`);
    lines.push(`export type ${responseName} = z.infer<typeof ${responseName}Schema>;`);
  }

  // Mock values are synthesized from the dereferenced plan's concrete media.
  const value = synthesizeMock(mockMethod?.mockResponse?.media);
  const factoryName = `mock${method.baseName}Response`;
  lines.push(
    `export function ${factoryName}(): ${responseName} {`,
    `  return ${JSON.stringify(value)};`,
    `}`,
  );
}
