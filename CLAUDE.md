# CLAUDE.md — `openapi-nextjs`

Context for Claude (and humans) working on this repository. Read this first.

## What this is

`openapi-nextjs` is a **public TypeScript dev-tool** distributed on npm. It is a CLI that takes an
OpenAPI / Swagger document (YAML or JSON) and **scaffolds a Next.js App Router API surface** from
it: one `route.ts` per path with typed handlers, runtime **zod** validation for params/body,
**mock** responses derived from the spec, and a full set of TypeScript types.

Target invocation:

```
npx openapi-nextjs generate openapi.yaml --route="src/app/api" --types="src/types" [--overwrite]
```

- `--route` (default `src/app/api`) — directory where Next.js App Router `route.ts` files are written.
- `--types` (default `src/types`) — directory for generated TypeScript types.
- `--overwrite` — re-emit `route.ts` handler files even if they already exist (default: skip existing).

## Stack & non-negotiables

- **Strict TypeScript** — `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`.
  **No `any`, no unchecked nulls.**
- **ESM package** (`"type": "module"`, `module`/`moduleResolution: NodeNext`).
- **pnpm** is the package manager.
- **Vitest** for all tests.
- **2-space indentation** in every code file.
- **Prettier** for formatting; flat-config **typescript-eslint** (strict-type-checked) for linting.
- **tsup** bundles the CLI + library to `dist/`.

## Architecture & data flow

Emitters are **pure** (return strings, never touch the filesystem) — this is what makes them
snapshot-testable. Only `fs/writer.ts` performs side effects.

```
load.ts → OpenAPIDocument → routePlan.ts → RoutePlan[] → emit/* (strings) → fs/writer.ts (I/O)
```

Every emitted string is run through `prettier.format()` before writing, so output is idiomatic and
snapshots are stable.

### Module map (`src/`)

- `cli.ts` — `#!/usr/bin/env node` bin entry; parses args with `node:util` `parseArgs`, calls `generate()`.
- `index.ts` — programmatic `generate()` library export.
- `config.ts` — `GenerateOptions` type, defaults, validation.
- `spec/load.ts` — loads YAML/JSON; runs **both** `bundle()` and `dereference()`; normalizes nullable.
- `spec/types.ts` — narrowed OpenAPI 3.x types we rely on.
- `plan/naming.ts` — operationId / type-name derivation + collision registry.
- `plan/routePlan.ts` — OpenAPI paths → `RoutePlan[]` (fs dirs + grouped HTTP methods).
- `emit/types.ts` — wraps `openapi-typescript`.
- `emit/zod.ts` — custom zod **source** emitter (body mode vs coerce mode).
- `emit/route.ts` — `route.ts` scaffold template.
- `emit/generated.ts` — `*.generated.ts` template (zod schemas + mock factories).
- `mock/synthesize.ts` — example-first → schema-fallback mock builder with cycle guard.
- `fs/writer.ts` — the ONLY side-effecting module (write/skip/overwrite policy).
- `util/logger.ts`, `util/ident.ts` — leveled logging; identifier/casing helpers.

## Critical design rules (do not regress these)

1. **`bundle()` for zod, `dereference()` for types/mocks.** `dereference()` destroys component
   identity and cannot terminate on circular `$ref`s in the zod emitter. `bundle()` preserves
   internal `$ref`s so each component is emitted **once** as a named const and referenced by
   identifier — this is what breaks cycles. The mock synthesizer uses the dereferenced doc plus an
   **identity `Set` cycle guard** and a `maxDepth` backstop.
2. **zod is a `peerDependency`** (`^4`). Generated code imports zod from the *consumer's* project;
   we must not bundle a second copy. **Emit zod 4 syntax**: `z.email()`, `z.uuid()`,
   `z.iso.datetime()`, `z.url()`, `z.record(key, value)`.
3. **Two files per route.** `route.ts` is scaffolded **once** and skipped if it exists (unless
   `--overwrite`) — handler bodies live here and are never clobbered. The sibling
   `<name>.generated.ts` (zod schemas + mock factories + type re-exports) is **always overwritten**
   and carries a `DO NOT EDIT` banner with **no timestamp** (timestamps would break idempotency and
   snapshots). The file boundary — not a comment marker — is what guarantees handler logic survives.
4. **Query/path/header params arrive as strings** → the zod emitter has a **coerce mode**
   (`z.coerce.number()`, etc.) distinct from **body mode**. `z.coerce.boolean()` treats `"false"`
   as truthy, so emit `z.enum(["true","false"]).transform(...)` for boolean query params instead.
5. **Deterministic output.** Sort paths, then iterate HTTP methods in a fixed verb order; use stable
   `_2`/`_3` collision suffixes. Regeneration must be byte-identical.
6. **Next.js 15+ App Router** is the target: `ctx.params` is a `Promise`. Documented assumption.

### Naming

- `operationId` present → PascalCase base (`getUserPosts` → `GetUserPosts`).
- absent → `{Method}{PathSegments}` (`GET /users/{userId}/posts` → `GetUsersUserIdPosts`).
- Operation types are always suffixed (`…Params`/`…Query`/`…Body`/`…Response`) so they never collide
  with bare component schema names. A collision registry guarantees uniqueness.

### Path → directory

Split on `/`; `{param}` → `[param]`; literal segments sanitized; root path → `<routeRoot>/route.ts`.
All HTTP methods on one OpenAPI path collapse into a single `route.ts` exporting one async function
per verb. Duplicate dynamic-param names within a single path → error.

## Per-iteration checklist (MANDATORY for every change)

- Use **2-space** indentation.
- Add **Vitest** tests for new implementations.
- Run **`pnpm test`** after the change.
- Run **`pnpm lint`** and **`pnpm typecheck`** — both must pass.
- Keep **strict TS** — no `any`, no unchecked nulls.
- Update **`README.md`** with any new setup steps or troubleshooting notes.

## Commands

```
pnpm install        # install deps
pnpm test           # vitest run
pnpm test:watch     # vitest watch
pnpm lint           # eslint
pnpm typecheck      # tsc --noEmit
pnpm build          # tsup → dist/
```

## Dependency versions (verified 2026-06)

- `openapi-typescript@^7` — `openapiTS()` returns an AST; stringify with `astToString()`.
- `@apidevtools/swagger-parser@^12` — exposes `bundle()` + `dereference()`; CJS, default-import interop.
- `zod@^4` — **peer** dependency.
- CLI args via **`node:util` `parseArgs`** (no `commander` — it is ESM-only and forces Node ≥22.12).
