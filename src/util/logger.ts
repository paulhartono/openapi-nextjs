/**
 * A tiny leveled logger.
 *
 * Messages go to **stderr** so the CLI's machine-readable summary on stdout stays
 * uncluttered. The level is read once from `OPENAPI_NEXTJS_LOG` (one of
 * `debug`/`info`/`warn`/`error`/`silent`); the default is `info`. The logger is
 * dependency-free and stateless beyond the resolved threshold.
 */

const LEVELS = ["debug", "info", "warn", "error", "silent"] as const;
type Level = (typeof LEVELS)[number];

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

function resolveThreshold(): number {
  const raw = process.env.OPENAPI_NEXTJS_LOG?.toLowerCase();
  const index = LEVELS.findIndex((level) => level === raw);
  // Default to "info" when unset or unrecognized.
  return index === -1 ? LEVELS.indexOf("info") : index;
}

const threshold = resolveThreshold();

function emit(level: Level, message: string): void {
  if (LEVELS.indexOf(level) < threshold) return;
  process.stderr.write(`openapi-nextjs ${level}: ${message}\n`);
}

export const logger: Logger = {
  debug: (message) => {
    emit("debug", message);
  },
  info: (message) => {
    emit("info", message);
  },
  warn: (message) => {
    emit("warn", message);
  },
  error: (message) => {
    emit("error", message);
  },
};
