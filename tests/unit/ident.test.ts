import { describe, expect, it } from "vitest";

import {
  isValidIdentifier,
  toCamelCase,
  toPascalCase,
  toValidIdentifier,
} from "../../src/util/ident.js";

describe("toPascalCase", () => {
  it.each([
    ["getUserPosts", "GetUserPosts"],
    ["get_user_posts", "GetUserPosts"],
    ["get-user-posts", "GetUserPosts"],
    ["GET /users/{userId}/posts", "GetUsersUserIdPosts"],
    ["", ""],
  ])("%s → %s", (input, expected) => {
    expect(toPascalCase(input)).toBe(expected);
  });
});

describe("toCamelCase", () => {
  it("lowercases the first word", () => {
    expect(toCamelCase("GetUserPosts")).toBe("getUserPosts");
    expect(toCamelCase("user_id")).toBe("userId");
  });
});

describe("toValidIdentifier", () => {
  it("strips illegal characters", () => {
    expect(toValidIdentifier("foo-bar.baz")).toBe("foobarbaz");
  });

  it("prefixes a leading digit", () => {
    expect(toValidIdentifier("123abc")).toBe("_123abc");
  });

  it("suffixes reserved words", () => {
    expect(toValidIdentifier("class")).toBe("class_");
    expect(toValidIdentifier("await")).toBe("await_");
  });

  it("returns _ for an empty result", () => {
    expect(toValidIdentifier("...")).toBe("_");
  });
});

describe("isValidIdentifier", () => {
  it.each([
    ["foo", true],
    ["_foo$1", true],
    ["1foo", false],
    ["foo-bar", false],
    ["class", false],
  ])("%s → %s", (input, expected) => {
    expect(isValidIdentifier(input)).toBe(expected);
  });
});
