import { describe, expect, it } from "vitest";

import { CliExit, parseCliArgs } from "../../src/cli.js";
import { DEFAULT_ROUTE_DIR, DEFAULT_TYPES_DIR } from "../../src/config.js";

describe("parseCliArgs", () => {
  it("parses the generate command with defaults", () => {
    const opts = parseCliArgs(["generate", "openapi.yaml"]);
    expect(opts).toEqual({
      input: "openapi.yaml",
      routeDir: DEFAULT_ROUTE_DIR,
      typesDir: DEFAULT_TYPES_DIR,
      overwrite: false,
    });
  });

  it("honors --route, --types, and --overwrite", () => {
    const opts = parseCliArgs([
      "generate",
      "spec.json",
      "--route",
      "src/app/api",
      "--types",
      "src/types",
      "--overwrite",
    ]);
    expect(opts.routeDir).toBe("src/app/api");
    expect(opts.typesDir).toBe("src/types");
    expect(opts.overwrite).toBe(true);
  });

  it("exits with code 0 on --help", () => {
    expect.assertions(2);
    try {
      parseCliArgs(["--help"]);
    } catch (error) {
      expect(error).toBeInstanceOf(CliExit);
      expect((error as CliExit).code).toBe(0);
    }
  });

  it("errors on an unknown command", () => {
    expect(() => parseCliArgs(["frobnicate", "x.yaml"])).toThrow(CliExit);
  });

  it("errors when the spec argument is missing", () => {
    expect(() => parseCliArgs(["generate"])).toThrow(/Missing <spec>/);
  });
});
