/**
 * The only side-effecting module in the pipeline.
 *
 * Emitters return pure, compact, unformatted source strings; this module formats
 * each one through prettier and writes it to disk under a per-file policy. Keeping
 * all I/O here is what makes the emitters snapshot-testable.
 *
 * Formatting uses a **fixed** prettier config rather than the consumer's
 * `.prettierrc`, so regeneration is byte-identical regardless of where the output
 * lands (see CLAUDE.md → "Deterministic output").
 */

import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import prettier from "prettier";

import { logger } from "../util/logger.js";

export { GENERATED_BANNER } from "../util/banner.js";

/** Fixed prettier options applied to all emitted files (mirrors the repo style). */
const PRETTIER_OPTIONS: prettier.Options = {
  parser: "typescript",
  tabWidth: 2,
  semi: true,
  singleQuote: false,
  trailingComma: "all",
  printWidth: 90,
};

/** How an existing file on disk is treated. */
export type WritePolicy = "overwrite" | "skip-if-exists";

export interface WriteTask {
  /** Absolute path to write. */
  path: string;
  /** Unformatted TS source (banner already included by the emitter where applicable). */
  source: string;
  policy: WritePolicy;
}

export interface WriteSummary {
  /** Absolute paths that were formatted and written. */
  written: string[];
  /** Absolute paths skipped because they already exist under `skip-if-exists`. */
  skipped: string[];
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Format and write each task, sequentially. Sequential processing keeps log order
 * deterministic and avoids `mkdir` races on shared parent directories; the file
 * volume per run is small, so there is no throughput concern.
 */
export async function writeAll(tasks: readonly WriteTask[]): Promise<WriteSummary> {
  const written: string[] = [];
  const skipped: string[] = [];

  for (const task of tasks) {
    if (task.policy === "skip-if-exists" && (await fileExists(task.path))) {
      logger.debug(`skipped ${task.path} (exists)`);
      skipped.push(task.path);
      continue;
    }

    const formatted = await prettier.format(task.source, PRETTIER_OPTIONS);
    await mkdir(dirname(task.path), { recursive: true });
    await writeFile(task.path, formatted, "utf8");
    logger.debug(`wrote ${task.path}`);
    written.push(task.path);
  }

  return { written, skipped };
}
