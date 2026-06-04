import { describe, expect, it } from "vitest";

import {
  artifactName,
  NameRegistry,
  operationBaseName,
} from "../../src/plan/naming.js";

describe("operationBaseName", () => {
  it("uses operationId when present", () => {
    expect(operationBaseName("get", "/users/{userId}/posts", "getUserPosts")).toBe(
      "GetUserPosts",
    );
  });

  it("synthesizes from method + path when operationId is absent", () => {
    expect(operationBaseName("get", "/users/{userId}/posts", undefined)).toBe(
      "GetUsersUserIdPosts",
    );
  });

  it("synthesizes from an empty operationId", () => {
    expect(operationBaseName("post", "/items", "  ")).toBe("PostItems");
  });

  it("handles the root path", () => {
    expect(operationBaseName("get", "/", undefined)).toBe("Get");
  });
});

describe("artifactName", () => {
  it("appends the suffix", () => {
    expect(artifactName("GetUserPosts", "Query")).toBe("GetUserPostsQuery");
    expect(artifactName("GetUserPosts", "Response")).toBe("GetUserPostsResponse");
  });
});

describe("NameRegistry", () => {
  it("returns the desired name when free", () => {
    const reg = new NameRegistry();
    expect(reg.claim("Post")).toBe("Post");
  });

  it("numbers collisions deterministically", () => {
    const reg = new NameRegistry();
    expect(reg.claim("Post")).toBe("Post");
    expect(reg.claim("Post")).toBe("Post_2");
    expect(reg.claim("Post")).toBe("Post_3");
  });

  it("avoids colliding a numbered variant with an explicit claim", () => {
    const reg = new NameRegistry();
    expect(reg.claim("Post")).toBe("Post");
    expect(reg.claim("Post_2")).toBe("Post_2");
    expect(reg.claim("Post")).toBe("Post_3");
  });

  it("reports membership", () => {
    const reg = new NameRegistry();
    reg.claim("Author");
    expect(reg.has("Author")).toBe(true);
    expect(reg.has("Missing")).toBe(false);
  });
});
