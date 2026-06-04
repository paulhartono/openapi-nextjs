import type { HttpMethod } from "../spec/types.js";
import { toPascalCase } from "../util/ident.js";

/**
 * Derives stable, collision-free names for operations and their generated types.
 *
 * Names are PascalCase. When an `operationId` is present it is the basis; when
 * absent, a name is synthesized from the HTTP method and path segments. Type
 * names are always suffixed (`Params`/`Query`/`Body`/`Response`) so they can
 * never collide with bare component schema names.
 */

/** The suffixes appended to an operation's base name to form type/schema names. */
export type OperationArtifact = "Params" | "Query" | "Headers" | "Cookies" | "Body" | "Response";

/**
 * Compute an operation's PascalCase base name.
 *
 * - `operationId` present → PascalCase of it (`getUserPosts` → `GetUserPosts`).
 * - absent → `{Method}{PathSegments}` with `{param}` braces stripped
 *   (`GET /users/{userId}/posts` → `GetUsersUserIdPosts`).
 */
export function operationBaseName(
  method: HttpMethod,
  path: string,
  operationId: string | undefined,
): string {
  if (operationId !== undefined && operationId.trim().length > 0) {
    return toPascalCase(operationId);
  }

  const segments = path
    .split("/")
    .map((segment) => segment.replace(/[{}]/g, ""))
    .filter((segment) => segment.length > 0);

  return toPascalCase([method, ...segments].join(" "));
}

/** Compose a type/schema name from a base name and an artifact suffix. */
export function artifactName(baseName: string, artifact: OperationArtifact): string {
  return `${baseName}${artifact}`;
}

/**
 * Hands out unique identifiers. On collision, appends `_2`, `_3`, … so output
 * is deterministic given a deterministic call order.
 */
export class NameRegistry {
  private readonly counts = new Map<string, number>();

  /** Claim `desired`, returning it or a numbered variant if already taken. */
  claim(desired: string): string {
    const existing = this.counts.get(desired);
    if (existing === undefined) {
      this.counts.set(desired, 1);
      return desired;
    }

    let next = existing + 1;
    let candidate = `${desired}_${String(next)}`;
    while (this.counts.has(candidate)) {
      next += 1;
      candidate = `${desired}_${String(next)}`;
    }
    this.counts.set(desired, next);
    this.counts.set(candidate, 1);
    return candidate;
  }

  /** True if `name` has already been claimed. */
  has(name: string): boolean {
    return this.counts.has(name);
  }
}
