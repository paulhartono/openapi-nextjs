/**
 * TypeScript type emitter.
 *
 * A thin wrapper around [`openapi-typescript`](https://github.com/openapi-ts/openapi-typescript):
 * `openapiTS()` returns a TypeScript AST (`ts.Node[]`) which `astToString()`
 * stringifies. The result is the full type-declaration source for one spec
 * (the `paths` / `operations` / `components` interfaces).
 *
 * Like the zod emitter, this is **pure**: it returns a TS source string and
 * never touches the filesystem, never runs prettier, and never prepends a
 * banner. Formatting and the `DO NOT EDIT` banner are the responsibility of the
 * forthcoming `fs/writer.ts`; `astToString` emits only the declarations, so we
 * deliberately do **not** use openapi-typescript's `COMMENT_HEADER`.
 *
 * Notes:
 *
 * - **Async.** `openapiTS` is asynchronous, so this emitter is `async` — unlike
 *   the synchronous zod emitter.
 * - **Bundled input.** The caller passes the **bundled** document
 *   (`loadSpec().bundled`), which preserves internal `$ref`s so the output emits
 *   named aliases (`components["schemas"]["Foo"]`) rather than inlining every
 *   schema. The function itself is agnostic — it accepts any `OpenAPIDocument`;
 *   the bundled-vs-dereferenced choice belongs to the caller.
 * - **Nullable.** `loadSpec` collapses both 3.0 `nullable: true` and 3.1
 *   `type: [..., "null"]` into a single 3.0-style `{ type, nullable: true }`.
 *   openapi-typescript understands the 3.0 `nullable` keyword and emits
 *   `… | null` for it, so the normalized form is valid input — no
 *   de-normalization is needed.
 * - **Boundary cast.** Our `OpenAPIDocument` is a narrowed structural type;
 *   `openapiTS` wants its own looser `OpenAPI3`. We cast once at the boundary,
 *   mirroring the `ParserInput` cast in `spec/load.ts`.
 */

import openapiTS, { astToString } from "openapi-typescript";
import type { OpenAPI3 } from "openapi-typescript";

import type { OpenAPIDocument } from "../spec/types.js";

/**
 * Emit the TypeScript type-declaration source for an OpenAPI document.
 *
 * @param doc The loaded document — callers pass the **bundled** view so the
 *   output references named component aliases instead of inlining schemas.
 * @returns The TS source (no banner, unformatted).
 */
export async function emitTypes(doc: OpenAPIDocument): Promise<string> {
  // Our narrowed `OpenAPIDocument` → openapi-typescript's looser `OpenAPI3`,
  // the same narrowed↔loose boundary cast `spec/load.ts` makes for the parser.
  const ast = await openapiTS(doc as unknown as OpenAPI3);
  return astToString(ast);
}
