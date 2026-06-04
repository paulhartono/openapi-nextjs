import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadSpec } from "../../src/spec/load.js";
import { buildRoutePlans, mapPathToDir } from "../../src/plan/routePlan.js";
import type { OpenAPIDocument } from "../../src/spec/types.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

describe("mapPathToDir", () => {
  it("maps a templated path to App Router segments", () => {
    expect(mapPathToDir("/users/{userId}/posts")).toEqual({
      routeDir: "users/[userId]/posts",
      dynamicParams: ["userId"],
    });
  });

  it("maps the root path to an empty dir", () => {
    expect(mapPathToDir("/")).toEqual({ routeDir: "", dynamicParams: [] });
  });

  it("sanitizes illegal characters in literal segments", () => {
    expect(mapPathToDir("/v1/foo bar").routeDir).toBe("v1/foo-bar");
  });

  it("throws on a duplicate dynamic param within one path", () => {
    expect(() => mapPathToDir("/a/{id}/b/{id}")).toThrow(/Duplicate path parameter/);
  });
});

describe("buildRoutePlans", () => {
  it("produces a deterministic, sorted list of plans", async () => {
    const { dereferenced } = await loadSpec(join(fixturesDir, "edge-cases.yaml"));
    const plans = buildRoutePlans(dereferenced);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.oasPath).toBe("/users/{userId}/posts");
    expect(plans[0]?.routeDir).toBe("users/[userId]/posts");
  });

  it("groups all HTTP methods on one path into one route plan", async () => {
    const { dereferenced } = await loadSpec(join(fixturesDir, "edge-cases.yaml"));
    const [plan] = buildRoutePlans(dereferenced);
    const handlers = plan?.methods.map((m) => m.handlerName);
    // Fixed verb order: get, post, delete.
    expect(handlers).toEqual(["GET", "POST", "DELETE"]);
  });

  it("derives base names from operationId or synthesizes them", async () => {
    const { dereferenced } = await loadSpec(join(fixturesDir, "edge-cases.yaml"));
    const [plan] = buildRoutePlans(dereferenced);
    const get = plan?.methods.find((m) => m.httpMethod === "get");
    const post = plan?.methods.find((m) => m.httpMethod === "post");
    expect(get?.baseName).toBe("GetUserPosts");
    // POST has no operationId → synthesized.
    expect(post?.baseName).toBe("PostUsersUserIdPosts");
  });

  it("splits parameters by location and includes shared path params", async () => {
    const { dereferenced } = await loadSpec(join(fixturesDir, "edge-cases.yaml"));
    const [plan] = buildRoutePlans(dereferenced);
    const get = plan?.methods.find((m) => m.httpMethod === "get");
    expect(get?.pathParams.map((p) => p.name)).toEqual(["userId"]);
    expect(get?.pathParams[0]?.required).toBe(true);
    expect(get?.queryParams.map((p) => p.name)).toEqual(["limit"]);
  });

  it("selects a request body and marks JSON content", async () => {
    const { dereferenced } = await loadSpec(join(fixturesDir, "edge-cases.yaml"));
    const [plan] = buildRoutePlans(dereferenced);
    const post = plan?.methods.find((m) => m.httpMethod === "post");
    expect(post?.requestBody?.contentType).toBe("application/json");
    expect(post?.requestBody?.isNonJson).toBe(false);
    expect(post?.requestBody?.required).toBe(true);
  });

  it("picks the lowest 2xx response for mocking", async () => {
    const { dereferenced } = await loadSpec(join(fixturesDir, "edge-cases.yaml"));
    const [plan] = buildRoutePlans(dereferenced);
    const post = plan?.methods.find((m) => m.httpMethod === "post");
    expect(post?.mockResponse?.status).toBe("201");
  });

  it("marks 204 responses as empty with no schema", async () => {
    const { dereferenced } = await loadSpec(join(fixturesDir, "edge-cases.yaml"));
    const [plan] = buildRoutePlans(dereferenced);
    const del = plan?.methods.find((m) => m.httpMethod === "delete");
    const mock = del?.mockResponse;
    expect(mock?.status).toBe("204");
    expect(mock?.isEmpty).toBe(true);
    expect(mock?.schema).toBeUndefined();
  });

  it("prefers a JSON content type for a multi-content body", () => {
    const doc: OpenAPIDocument = {
      openapi: "3.0.3",
      info: { title: "Multi", version: "1.0.0" },
      paths: {
        "/upload": {
          post: {
            operationId: "upload",
            requestBody: {
              required: true,
              content: {
                "multipart/form-data": { schema: { type: "object" } },
                "application/json": { schema: { type: "object" } },
              },
            },
            responses: { "200": { description: "ok" } },
          },
        },
      },
    };
    const [plan] = buildRoutePlans(doc);
    expect(plan?.methods[0]?.requestBody?.contentType).toBe("application/json");
  });

  it("returns an empty list for a document with no paths", () => {
    const doc: OpenAPIDocument = {
      openapi: "3.0.3",
      info: { title: "Empty", version: "1.0.0" },
    };
    expect(buildRoutePlans(doc)).toEqual([]);
  });
});
