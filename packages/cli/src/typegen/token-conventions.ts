/**
 * Token convention validator (architecture.md §22.4 #1).
 *
 * Warns (never errors) on `createToken('literal')` calls whose literal
 * doesn't match the convention from §22.2:
 *
 *   <scope>/<PascalKey>[/<suffix>][:<instance>[:<extra>]*]
 *
 * Where `<scope>` is lowercase + may start with the reserved `kick/`
 * prefix for first-party tokens. Legacy framework tokens that started
 * with `kickjs.` (pre-§22) are exempt — they get migrated alongside
 * the first-party adapter migrations.
 *
 * The matching reserved-prefix check (third-party tokens squatting
 * `kick/`) is the responsibility of `@forinda/kickjs-lint`'s
 * `token-reserved-prefix` rule, not the typegen layer — different
 * audience (adopter codebase) and different default severity.
 *
 * @module @forinda/kickjs-cli/typegen/token-conventions
 */

import type { DiscoveredToken } from './scanner'

/**
 * Regex for the §22.2 token shape. Breakdown:
 *
 * - `^(kick\/)?` — optional reserved framework prefix.
 * - `([a-z][\w-]*\/[A-Z]\w*)` — `<scope>/<PascalKey>`. Scope is
 *   lowercase, key is PascalCase.
 * - `(\/.+)?` — optional `/suffix` for sub-flavours
 *   (e.g. `mycorp/Cache/redis`).
 * - `(:[a-z][\w-]+(:[a-z][\w-]+)*)?` — optional `:instance` (and
 *   further `:extra` colon-sections) for `.scoped()` shards.
 */
const TOKEN_CONVENTION_REGEX =
  /^(kick\/)?([a-z][\w-]*\/[A-Z]\w*)(\/.+)?(:[a-z][\w-]+(:[a-z][\w-]+)*)?$/

const LEGACY_PREFIX = 'kickjs.'

export interface TokenConventionWarning {
  token: string
  variable: string | null
  filePath: string
  reason: string
  suggestion?: string
}

export function validateTokenConventions(
  tokens: readonly DiscoveredToken[],
): TokenConventionWarning[] {
  const warnings: TokenConventionWarning[] = []
  for (const token of tokens) {
    const name = token.name
    if (name.startsWith(LEGACY_PREFIX)) continue
    if (TOKEN_CONVENTION_REGEX.test(name)) continue
    warnings.push({
      token: name,
      variable: token.variable,
      filePath: token.relativePath,
      reason: 'does not match `<scope>/<PascalKey>[/<suffix>][:<instance>]`',
      suggestion: suggestRename(name),
    })
  }
  return warnings
}

function suggestRename(name: string): string | undefined {
  if (/^[A-Z]\w*$/.test(name)) {
    return `'<scope>/${name}' (e.g. 'mycorp/${name}')`
  }
  if (name.includes('.')) {
    return `consider '<scope>/PascalKey' instead of dotted form`
  }
  const slashLower = /^([a-z][\w-]*)\/([a-z]\w*)$/.exec(name)
  if (slashLower) {
    const [, scope, key] = slashLower
    return `'${scope}/${key.charAt(0).toUpperCase()}${key.slice(1)}'`
  }
  return undefined
}
