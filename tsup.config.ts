import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    index: "src/index.ts",
  },
  format: ["esm"],
  target: "node20",
  dts: true,
  clean: true,
  sourcemap: true,
  // Keep heavy deps external — smaller install, avoids re-bundling ESM-only libs.
  external: ["@apidevtools/swagger-parser", "openapi-typescript", "prettier", "zod"],
});
