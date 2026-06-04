/**
 * `route.ts` scaffold emitter.
 *
 * Produces the **write-once** handler file for one OpenAPI path: one exported
 * async function per HTTP method, each validating its params/body against the
 * sibling `route.generated.ts` schemas and returning the mock response. This file
 * is the user's to edit — it is skipped on regeneration (unless `--overwrite`),
 * so it carries **no** `DO NOT EDIT` banner. Like the other emitters this is pure.
 *
 * Targets Next.js 15+: the route-handler `ctx.params` is a `Promise`, so handlers
 * `await ctx.params` before validating path params (CLAUDE.md rule 6).
 */

import { artifactName } from "../plan/naming.js";
import type { MethodPlan, RoutePlan } from "../plan/routePlan.js";
import { isValidIdentifier } from "../util/ident.js";

export interface RouteEmitContext {
  /** Extensionless specifier for the sibling generated file, e.g. `./route.generated`. */
  generatedModule: string;
}

/** Emit the `route.ts` scaffold source for one route plan. */
export function emitRoute(plan: RoutePlan, ctx: RouteEmitContext): string {
  const imports = new Set<string>();
  const handlers = plan.methods.map((method) => emitHandler(method, plan, imports));

  const importBlock =
    imports.size === 0
      ? ""
      : `import {\n${[...imports]
          .sort()
          .map((name) => `  ${name},`)
          .join("\n")}\n} from "${ctx.generatedModule}";\n\n`;

  const head = `import { NextResponse } from "next/server";\nimport type { NextRequest } from "next/server";\n\n`;

  return `${head}${importBlock}${handlers.join("\n\n")}\n`;
}

/** The type for `ctx.params` built from the path's dynamic segments. */
function paramsType(plan: RoutePlan): string {
  const entries = plan.dynamicParams.map((name) => {
    const key = isValidIdentifier(name) ? name : JSON.stringify(name);
    return `${key}: string`;
  });
  return `{ ${entries.join("; ")} }`;
}

/** Emit one exported async handler, recording the generated symbols it imports. */
function emitHandler(method: MethodPlan, plan: RoutePlan, imports: Set<string>): string {
  const hasParams = plan.dynamicParams.length > 0;
  const signature = hasParams
    ? `export async function ${method.handlerName}(\n  request: NextRequest,\n  ctx: { params: Promise<${paramsType(plan)}> },\n) {`
    : `export async function ${method.handlerName}(request: NextRequest) {`;

  const body: string[] = [signature];

  if (method.pathParams.length > 0) {
    const name = artifactName(method.baseName, "Params");
    imports.add(name);
    body.push(...validation(name, "await ctx.params", "path parameters", "params"));
  }

  if (method.queryParams.length > 0) {
    const name = artifactName(method.baseName, "Query");
    imports.add(name);
    body.push(
      `  const url = new URL(request.url);`,
      ...validation(
        name,
        "Object.fromEntries(url.searchParams)",
        "query parameters",
        "query",
      ),
    );
  }

  if (method.requestBody !== undefined) {
    const name = artifactName(method.baseName, "Body");
    imports.add(name);
    const source = method.requestBody.isNonJson
      ? "await request.formData()"
      : "await request.json()";
    body.push(...validation(name, source, "request body", "body"));
  }

  body.push("", `  // TODO: implement ${method.handlerName} ${plan.oasPath}`);
  body.push(...responseStatement(method, imports));
  body.push("}");

  return body.join("\n");
}

/** A `safeParse` guard that returns a 400 with the zod issues on failure. */
function validation(
  schemaName: string,
  source: string,
  label: string,
  varName: string,
): string[] {
  return [
    `  const ${varName} = ${schemaName}.safeParse(${source});`,
    `  if (!${varName}.success) {`,
    `    return NextResponse.json(`,
    `      { error: "Invalid ${label}", issues: ${varName}.error.issues },`,
    `      { status: 400 },`,
    `    );`,
    `  }`,
  ];
}

/** The terminal response: a typed mock for a body response, else an empty body. */
function responseStatement(method: MethodPlan, imports: Set<string>): string[] {
  const mock = method.mockResponse;
  if (mock === undefined) {
    return [`  return new NextResponse(null, { status: 200 });`];
  }

  const status = Number.parseInt(mock.status, 10);
  const statusLiteral = Number.isNaN(status) ? 200 : status;

  if (mock.isEmpty || mock.schema === undefined) {
    return [`  return new NextResponse(null, { status: ${String(statusLiteral)} });`];
  }

  const factory = `mock${method.baseName}Response`;
  imports.add(factory);
  return [
    `  return NextResponse.json(${factory}(), { status: ${String(statusLiteral)} });`,
  ];
}
