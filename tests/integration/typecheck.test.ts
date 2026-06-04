/**
 * Integration test: typecheck the *generated output* with the TypeScript compiler.
 *
 * Every other test exercises the emitters in isolation; none proves the emitted
 * files actually compile together. This runs `generate()` over real fixtures into
 * a temp dir, then drives the TypeScript Compiler API in-process over the written
 * files and asserts zero diagnostics — a CI gate on the "the output typechecks for
 * consumers" guarantee.
 *
 * Two specifiers in the emitted code would not resolve from a temp dir:
 *   - `zod` (real peer dep) — pointed at the repo's installed copy via `paths`.
 *   - `next/server` (heavy consumer peer dep, intentionally not installed here) —
 *     satisfied by a minimal ambient stub written alongside the output.
 *
 * Compiler options mirror a real Next.js App Router project: strict flags from the
 * repo tsconfig plus the DOM lib (the source of `URL` and `FormData`).
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { generate } from "../../src/generate.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const require = createRequire(import.meta.url);
const zodDir = dirname(require.resolve("zod/package.json"));

/** Minimal `next/server` surface used by emitted handlers (see emit/route.ts). */
const NEXT_STUB = `declare module "next/server" {
  export interface NextRequest {
    readonly url: string;
    json(): Promise<unknown>;
    formData(): Promise<FormData>;
  }
  export class NextResponse {
    constructor(body?: BodyInit | null, init?: { status?: number });
    static json(body: unknown, init?: { status?: number }): NextResponse;
  }
}
`;

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "openapi-nextjs-tsc-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Strict compiler options mirroring a Next.js consumer, with `zod` resolvable. */
function compilerOptions(): ts.CompilerOptions {
  return {
    target: ts.ScriptTarget.ES2022,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    // Mirror a real Next.js consumer: bundler resolution reads package `exports`
    // (so `zod` resolves) and permits extensionless relative imports, matching the
    // extensionless specifiers the emitters produce.
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    noImplicitOverride: true,
    noFallthroughCasesInSwitch: true,
    noImplicitReturns: true,
    verbatimModuleSyntax: true,
    isolatedModules: true,
    esModuleInterop: true,
    forceConsistentCasingInFileNames: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
    baseUrl: dir,
    paths: { zod: [zodDir], "zod/*": [join(zodDir, "*")] },
  };
}

function format(diagnostics: readonly ts.Diagnostic[]): string {
  const host: ts.FormatDiagnosticsHost = {
    getCanonicalFileName: (f) => f,
    getCurrentDirectory: () => dir,
    getNewLine: () => "\n",
  };
  return ts.formatDiagnostics(diagnostics, host);
}

/** Generate the fixture into the temp dir and typecheck every emitted `.ts` file. */
async function typecheckFixture(fixture: string): Promise<void> {
  const result = await generate({
    input: join(fixturesDir, fixture),
    routeDir: join(dir, "app", "api"),
    typesDir: join(dir, "types"),
    overwrite: false,
  });

  // Mark the temp tree as an ESM package, matching a real Next.js consumer and
  // the `module: ESNext` we compile with.
  await writeFile(join(dir, "package.json"), `{ "type": "module" }\n`, "utf8");

  const stubPath = join(dir, "next-server.d.ts");
  await writeFile(stubPath, NEXT_STUB, "utf8");

  const rootFiles = [...result.written.filter((p) => p.endsWith(".ts")), stubPath];
  const program = ts.createProgram(rootFiles, compilerOptions());
  const diagnostics = ts.getPreEmitDiagnostics(program);

  expect(diagnostics.length, format(diagnostics)).toBe(0);
}

describe("tsc-on-output integration", () => {
  it("edge-cases output typechecks under strict TS", async () => {
    await typecheckFixture("edge-cases.yaml");
  }, 30_000);

  it("minimal output typechecks under strict TS", async () => {
    await typecheckFixture("minimal.yaml");
  }, 30_000);
});
