/**
 * The `generate()` orchestrator: the one place the pure stages are composed and
 * handed to the side-effecting writer.
 *
 *   loadSpec → buildComponentSchemas(bundled)
 *            → buildRoutePlans(bundled)      (structure + zod source of truth)
 *            → buildRoutePlans(dereferenced) (concrete schemas for mocks)
 *            → emit route.ts + route.generated.ts per path
 *            → emitTypes(bundled)
 *            → writeAll(tasks)
 *
 * The zod consts need the **bundled** view (so `$ref`s survive and resolve to
 * named consts); the mock values need the **dereferenced** view. Both plan lists
 * are built deterministically (CLAUDE.md rule 5), so they zip by index.
 */

import { resolve } from "node:path";

import type { GenerateOptions } from "./config.js";
import { emitGenerated } from "./emit/generated.js";
import { emitRoute } from "./emit/route.js";
import { emitTypes } from "./emit/types.js";
import { buildComponentSchemas } from "./emit/zod.js";
import { GENERATED_BANNER, writeAll } from "./fs/writer.js";
import type { WriteTask } from "./fs/writer.js";
import { buildRoutePlans } from "./plan/routePlan.js";
import type { RoutePlan } from "./plan/routePlan.js";
import { loadSpec } from "./spec/load.js";

const SCHEMAS_FILE = "_schemas.generated.ts";
const SCHEMAS_MODULE = "_schemas.generated";
const TYPES_FILE = "api.generated.ts";

export interface GenerateResult {
  /** Absolute paths written this run. */
  written: string[];
  /** Absolute paths skipped because an existing `route.ts` was preserved. */
  skipped: string[];
  /** Number of OpenAPI paths processed. */
  routeCount: number;
}

/** Load a spec and emit the full Next.js App Router surface to disk. */
export async function generate(options: GenerateOptions): Promise<GenerateResult> {
  const { dereferenced, bundled } = await loadSpec(options.input);

  const components = buildComponentSchemas(bundled);
  const bundledPlans = buildRoutePlans(bundled);
  const derefPlans = buildRoutePlans(dereferenced);

  if (bundledPlans.length !== derefPlans.length) {
    throw new Error(
      "Internal error: bundled and dereferenced route plans diverged — " +
        "cannot align mock data with schemas.",
    );
  }

  const cwd = process.cwd();
  const routeRoot = resolve(cwd, options.routeDir);
  const tasks: WriteTask[] = [];

  for (let i = 0; i < bundledPlans.length; i += 1) {
    const plan = bundledPlans[i];
    const mockPlan = derefPlans[i];
    if (plan === undefined || mockPlan === undefined) continue;

    const dir = resolve(routeRoot, plan.routeDir);
    const generatedSource = emitGenerated(plan, {
      resolveRef: components.resolveRef,
      schemasModule: schemasModuleFor(plan),
      mockPlan,
    });
    const routeSource = emitRoute(plan, { generatedModule: "./route.generated" });

    tasks.push({
      path: resolve(dir, "route.generated.ts"),
      source: generatedSource,
      policy: "overwrite",
    });
    tasks.push({
      path: resolve(dir, "route.ts"),
      source: routeSource,
      policy: options.overwrite ? "overwrite" : "skip-if-exists",
    });
  }

  tasks.push({
    path: resolve(routeRoot, SCHEMAS_FILE),
    source: `${GENERATED_BANNER}\nimport { z } from "zod";\n\n${components.emitConstsBlock()}\n`,
    policy: "overwrite",
  });

  const typesSource = `${GENERATED_BANNER}\n${await emitTypes(bundled)}`;
  tasks.push({
    path: resolve(cwd, options.typesDir, TYPES_FILE),
    source: typesSource,
    policy: "overwrite",
  });

  const summary = await writeAll(tasks);
  return { ...summary, routeCount: bundledPlans.length };
}

/** The `../`-prefixed specifier from a route's directory back to the shared schemas file. */
function schemasModuleFor(plan: RoutePlan): string {
  const depth = plan.routeDir === "" ? 0 : plan.routeDir.split("/").length;
  const prefix = depth === 0 ? "./" : "../".repeat(depth);
  return `${prefix}${SCHEMAS_MODULE}`;
}
