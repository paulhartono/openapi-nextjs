/**
 * Options for a generation run. Mirrors the CLI flags one-to-one.
 */
export interface GenerateOptions {
  /** Path to the OpenAPI/Swagger file (YAML or JSON), or an in-memory document. */
  input: string;
  /** Directory for generated Next.js `route.ts` files. */
  routeDir: string;
  /** Directory for generated TypeScript types. */
  typesDir: string;
  /** Re-emit `route.ts` handlers even if they already exist. */
  overwrite: boolean;
}

export const DEFAULT_ROUTE_DIR = "src/app/api";
export const DEFAULT_TYPES_DIR = "src/types";

/**
 * Fill in defaults and validate required fields. Throws on an empty input path.
 */
export function resolveOptions(
  partial: Partial<GenerateOptions> & Pick<GenerateOptions, "input">,
): GenerateOptions {
  if (partial.input.trim().length === 0) {
    throw new Error("An input OpenAPI file path is required.");
  }
  return {
    input: partial.input,
    routeDir: partial.routeDir ?? DEFAULT_ROUTE_DIR,
    typesDir: partial.typesDir ?? DEFAULT_TYPES_DIR,
    overwrite: partial.overwrite ?? false,
  };
}
