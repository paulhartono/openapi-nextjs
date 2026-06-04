# openapi-nextjs

Generate a [Next.js App Router](https://nextjs.org/docs/app) API surface from an OpenAPI / Swagger
spec — typed handlers, runtime [zod](https://zod.dev) validation, mock responses, and TypeScript
types.

> **Status:** the `generate` command is functional end-to-end — it loads/validates the spec, plans
> the routes, and writes the full Next.js App Router surface (handlers, zod validators, mock
> factories, and types) to disk. A `tsc`-on-output integration test compiles the generated
> files with the TypeScript compiler to guarantee the output typechecks for consumers.

## What it does

Point it at an OpenAPI document (YAML or JSON) and it scaffolds:

- `route.ts` handlers (one per path, one exported function per HTTP method) under your App Router.
- zod validators for path/query params and request bodies.
- Mock responses derived from the spec (`example`/`examples` first, then synthesized from schema).
- A full set of TypeScript types via [`openapi-typescript`](https://github.com/openapi-ts/openapi-typescript).

## Usage

```sh
npx openapi-nextjs generate openapi.yaml --route="src/app/api" --types="src/types"
```

### Options

| Flag          | Default        | Description                                                        |
| ------------- | -------------- | ------------------------------------------------------------------ |
| `--route`     | `src/app/api`  | Directory for generated Next.js `route.ts` files.                  |
| `--types`     | `src/types`    | Directory for generated TypeScript types.                          |
| `--overwrite` | `false`        | Re-emit `route.ts` handlers even if they already exist.            |

### Output layout

For each OpenAPI path, `generate` writes two sibling files under `--route`:

- `route.ts` — scaffolded **once**. Your handler logic lives here and is **never overwritten**
  (skipped on re-run unless `--overwrite`).
- `route.generated.ts` — zod schemas + mock factories + type re-exports. **Always regenerated**,
  carries a `DO NOT EDIT` banner.

Plus two shared files:

- `<route>/_schemas.generated.ts` — the spec's component schemas, emitted once as named zod consts
  and imported by every `route.generated.ts`. **Always regenerated.**
- `<types>/api.generated.ts` — the full TypeScript type surface from `openapi-typescript`.
  **Always regenerated.**

```
src/app/api/
  _schemas.generated.ts
  users/[userId]/posts/
    route.ts             ← yours to edit
    route.generated.ts   ← regenerated
src/types/
  api.generated.ts
```

This file-boundary split — not a comment marker — is what lets you safely re-run `generate` after
the spec changes without losing handler code. Regeneration of the `*.generated.ts` files is
byte-identical (no timestamps), so they diff cleanly in version control.

## Requirements

- **Node.js ≥ 20**
- **Next.js 15+** (generated handlers assume the async `params` App Router contract)
- **zod ^4** must be installed in your project (it is a peer dependency; the generated code imports it)

## Development

This project uses **pnpm**, **TypeScript** (strict), and **Vitest**.

```sh
pnpm install
pnpm test        # run the test suite
pnpm test:watch  # watch mode
pnpm lint        # eslint (typescript-eslint strict)
pnpm typecheck   # tsc --noEmit
pnpm build       # bundle to dist/ with tsup
```

See [CLAUDE.md](./CLAUDE.md) for the full architecture and contributor contract.

## Contributing

Contributions are welcome — this is an open-source MIT project.

1. Fork the repo and create a branch: `git checkout -b feat/<thing>`.
2. Make your change following [CLAUDE.md](./CLAUDE.md) (strict TypeScript, 2-space indentation,
   and a **Vitest** test for every new behavior).
3. Run the full local gate before pushing:
   ```sh
   pnpm lint && pnpm typecheck && pnpm test && pnpm build
   ```
4. Open a pull request. CI ([`.github/workflows/ci.yml`](./.github/workflows/ci.yml)) runs
   lint, typecheck, test, and build on **Node 20 and 22** for every PR — all checks must pass
   before a merge.

## Releasing a new version

Maintainer steps to cut and publish a release to npm after PRs have landed on `main`:

```sh
git checkout main && git pull          # start from the latest main
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm build   # full gate

npm version patch                      # patch | minor | major — bumps package.json + creates a git tag
git push --follow-tags origin main     # push the version commit and tag

npm publish --access public            # publish to npm (prepublishOnly rebuilds dist/ automatically)
npm view openapi-nextjs version        # verify the new version is live
```

- Follow [semver](https://semver.org): `patch` for bug fixes, `minor` for additive features,
  `major` for breaking changes.
- The `prepublishOnly` script rebuilds `dist/` at publish time, so the published tarball is never
  stale.
- Publishing requires npm publish rights — the maintainer must be logged in (`npm login`) as an
  owner of the package.

## Roadmap

- [x] Project skeleton, tooling, spec loader, route planner
- [x] zod emitter (body + coerce modes)
- [x] Type generator (openapi-typescript wrapper)
- [x] Mock synthesizer
- [x] Route + generated-file emitters and the `generate` command
- [x] `tsc`-on-output integration test

## License

MIT
