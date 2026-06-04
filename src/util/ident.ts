/**
 * Identifier and casing helpers shared by the naming and emitter modules.
 *
 * Everything here is deterministic and pure so generated names are stable across
 * runs (a hard requirement for idempotent regeneration — see CLAUDE.md).
 */

/** Reserved words we must never emit as a bare identifier. */
const RESERVED = new Set([
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
  "let",
  "static",
  "implements",
  "interface",
  "package",
  "private",
  "protected",
  "public",
  "await",
]);

/** Split an arbitrary string into lowercase word tokens. */
function words(input: string): string[] {
  return input
    // insert a boundary between a lowercase/digit and an uppercase letter
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    // any run of non-alphanumerics is a separator
    .split(/[^a-zA-Z0-9]+/)
    .filter((w) => w.length > 0)
    .map((w) => w.toLowerCase());
}

function capitalize(word: string): string {
  return word.length === 0 ? word : `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`;
}

/** `getUser-posts` → `GetUserPosts`. */
export function toPascalCase(input: string): string {
  return words(input).map(capitalize).join("");
}

/** `Get user_posts` → `getUserPosts`. */
export function toCamelCase(input: string): string {
  const pascal = toPascalCase(input);
  return pascal.length === 0
    ? pascal
    : `${pascal[0]?.toLowerCase() ?? ""}${pascal.slice(1)}`;
}

/**
 * Coerce an arbitrary string into a valid JS identifier: strip illegal chars,
 * prefix a leading digit, and suffix reserved words with `_`. Returns `_` for
 * an otherwise-empty result so the output is always usable.
 */
export function toValidIdentifier(input: string): string {
  let ident = input.replace(/[^a-zA-Z0-9_$]/g, "");
  if (ident.length === 0) ident = "_";
  if (/^[0-9]/.test(ident)) ident = `_${ident}`;
  if (RESERVED.has(ident)) ident = `${ident}_`;
  return ident;
}

/** True when `input` is already a valid, non-reserved JS identifier. */
export function isValidIdentifier(input: string): boolean {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(input) && !RESERVED.has(input);
}
