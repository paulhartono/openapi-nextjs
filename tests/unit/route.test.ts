import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadSpec } from "../../src/spec/load.js";
import { buildRoutePlans } from "../../src/plan/routePlan.js";
import type { RoutePlan } from "../../src/plan/routePlan.js";
import { emitRoute } from "../../src/emit/route.js";
import type { OpenAPIDocument } from "../../src/spec/types.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

async function edgeCasePlan(): Promise<RoutePlan> {
  const { bundled } = await loadSpec(join(fixturesDir, "edge-cases.yaml"));
  const [plan] = buildRoutePlans(bundled);
  if (plan === undefined) throw new Error("expected a route plan");
  return plan;
}

const ctx = { generatedModule: "./route.generated" };

describe("emitRoute — edge-cases route", () => {
  it("emits one async handler per HTTP method", async () => {
    const source = emitRoute(await edgeCasePlan(), ctx);
    expect(source).toContain("export async function GET(");
    expect(source).toContain("export async function POST(");
    expect(source).toContain("export async function DELETE(");
  });

  it("imports from the sibling generated module", async () => {
    const source = emitRoute(await edgeCasePlan(), ctx);
    expect(source).toContain(`} from "./route.generated";`);
    expect(source).toContain(`import { NextResponse } from "next/server";`);
    expect(source).toContain(`import type { NextRequest } from "next/server";`);
  });

  it("awaits ctx.params and validates path + query params for GET", async () => {
    const source = emitRoute(await edgeCasePlan(), ctx);
    expect(source).toContain("ctx: { params: Promise<{ userId: string }> }");
    expect(source).toContain("GetUserPostsParams.safeParse(await ctx.params)");
    expect(source).toContain("const url = new URL(request.url);");
    expect(source).toContain(
      "GetUserPostsQuery.safeParse(Object.fromEntries(url.searchParams))",
    );
    expect(source).toContain(
      "return NextResponse.json(mockGetUserPostsResponse(), { status: 200 });",
    );
  });

  it("validates the JSON body and returns status 201 for POST", async () => {
    const source = emitRoute(await edgeCasePlan(), ctx);
    expect(source).toContain("PostUsersUserIdPostsBody.safeParse(await request.json())");
    expect(source).toContain(
      "return NextResponse.json(mockPostUsersUserIdPostsResponse(), { status: 201 });",
    );
  });

  it("returns an empty 204 with no mock factory for DELETE", async () => {
    const source = emitRoute(await edgeCasePlan(), ctx);
    expect(source).toContain("return new NextResponse(null, { status: 204 });");
    expect(source).not.toContain("mockDeleteUserPostsResponse");
  });

  it("returns a 400 with zod issues on a validation failure", async () => {
    const source = emitRoute(await edgeCasePlan(), ctx);
    expect(source).toContain(`{ error: "Invalid path parameters", issues:`);
    expect(source).toContain("{ status: 400 }");
  });

  it("is a stable snapshot", async () => {
    expect(emitRoute(await edgeCasePlan(), ctx)).toMatchSnapshot();
  });
});

describe("emitRoute — a route with no dynamic params", () => {
  const doc: OpenAPIDocument = {
    openapi: "3.0.3",
    info: { title: "Ping", version: "1.0.0" },
    paths: {
      "/ping": {
        get: {
          operationId: "ping",
          responses: {
            "200": {
              description: "ok",
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
        },
      },
    },
  };

  it("omits the ctx parameter when there are no dynamic segments", () => {
    const [plan] = buildRoutePlans(doc);
    if (plan === undefined) throw new Error("expected a plan");
    const source = emitRoute(plan, ctx);
    expect(source).toContain("export async function GET(request: NextRequest) {");
    expect(source).not.toContain("ctx.params");
  });
});
