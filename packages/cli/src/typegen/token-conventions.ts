/**
 * Token convention validator.
 *
 * Warns (never errors) on `createToken('literal')` calls whose literal
 * doesn't follow the documented DI token convention:
 *
 *   <scope>/<area>[/<key>...][:<instance>[:<extra>]*]
 *
 * `<scope>` is lowercase — `kick` for first-party tokens, the app's own
 * scope otherwise (`app/tenants/repository`, `taskboard/Db`). The later
 * segments are identifiers in any case. Legacy framework tokens that started
 * with `kickjs.` are exempt.
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
 * - `^[a-z][a-z\d_-]*` — the scope, lowercase throughout (`kick`, `app`, `mycorp`).
 * - `(\/[A-Za-z][\w-]*)+` — one or more `/area`, `/key` segments.
 * - `(:[a-z][\w-]+)*` — optional `:instance` (and further `:extra`
 *   sections) for `.scoped()` shards.
 */
const TOKEN_CONVENTION_REGEX = /^[a-z][a-z\d_-]*(\/[A-Za-z][\w-]*)+(:[a-z][\w-]+)*$/

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
      reason: 'does not match `<scope>/<area>/<key>[:<instance>]`',
      suggestion: suggestRename(name),
    })
  }
  return warnings
}

function suggestRename(name: string): string | undefined {
  if (/^[A-Za-z]\w*$/.test(name)) {
    return `'<scope>/<area>/${name}' (e.g. 'app/${name}')`
  }
  if (name.includes('.')) {
    return `'${name.toLowerCase().split('.').join('/')}' — slashes, not dots`
  }
  return undefined
}
