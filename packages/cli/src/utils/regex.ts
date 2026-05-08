/**
 * Escape a string for safe interpolation into a `new RegExp(...)`
 * source. Each character that has special meaning inside a regex
 * pattern (`.`, `*`, `+`, `?`, `^`, `$`, `{`, `}`, `(`, `)`, `|`,
 * `[`, `]`, `\`) is prefixed with a backslash so it's matched
 * literally instead of treated as a metacharacter.
 *
 * Used everywhere the codegen / removal flow builds a regex from
 * adopter-provided identifiers (`pascal`, `plural`, etc). Names
 * coming through `toPascalCase` / `toKebabCase` are already
 * alphanumeric in practice, but escaping defensively keeps the
 * code correct if upstream sanitization ever loosens.
 */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
