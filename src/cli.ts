#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { argv } from "node:process";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { DEFAULT_ROUTE_DIR, DEFAULT_TYPES_DIR, resolveOptions } from "./config.js";
import type { GenerateOptions } from "./config.js";
import { generate } from "./generate.js";

const USAGE = `openapi-nextjs — scaffold Next.js App Router routes from an OpenAPI spec

Usage:
  openapi-nextjs generate <spec> [options]

Arguments:
  <spec>            Path to an OpenAPI/Swagger file (YAML or JSON)

Options:
  --route <dir>     Output dir for route.ts files   (default: ${DEFAULT_ROUTE_DIR})
  --types <dir>     Output dir for TypeScript types  (default: ${DEFAULT_TYPES_DIR})
  --overwrite       Re-emit route.ts even if it exists
  -h, --help        Show this help
`;

/** Parse argv into validated {@link GenerateOptions}; throws on misuse. */
export function parseCliArgs(argv: readonly string[]): GenerateOptions {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      route: { type: "string" },
      types: { type: "string" },
      overwrite: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    throw new CliExit(USAGE, 0);
  }

  const [command, input] = positionals;
  if (command !== "generate") {
    throw new CliExit(`Unknown command "${command ?? ""}".\n\n${USAGE}`, 1);
  }
  if (input === undefined) {
    throw new CliExit(`Missing <spec> argument.\n\n${USAGE}`, 1);
  }

  return resolveOptions({
    input,
    ...(values.route !== undefined ? { routeDir: values.route } : {}),
    ...(values.types !== undefined ? { typesDir: values.types } : {}),
    overwrite: values.overwrite,
  });
}

/** Carries an exit message + code out of arg parsing without calling process.exit. */
export class CliExit extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
    this.name = "CliExit";
  }
}

export async function main(): Promise<void> {
  try {
    const options = parseCliArgs(argv.slice(2));
    const result = await generate(options);
    process.stdout.write(
      `openapi-nextjs: generated ${String(result.routeCount)} route(s) — ` +
        `written ${String(result.written.length)}, skipped ${String(result.skipped.length)}.\n`,
    );
  } catch (error) {
    if (error instanceof CliExit) {
      const stream = error.code === 0 ? process.stdout : process.stderr;
      stream.write(`${error.message}\n`);
      process.exitCode = error.code;
      return;
    }
    process.stderr.write(
      `Error: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

// Only run when invoked directly as the bin, not when imported (e.g. by tests).
// argv[1] may be a symlink (npx / node_modules/.bin point at dist/cli.js), so
// resolve it to its real path before comparing to this module's own URL.
const entrypoint = argv[1];
if (entrypoint !== undefined) {
  try {
    if (pathToFileURL(realpathSync(entrypoint)).href === import.meta.url) {
      void main();
    }
  } catch {
    // argv[1] is not a resolvable path (e.g. embedded/REPL use) — do nothing.
  }
}
