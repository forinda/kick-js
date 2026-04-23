/**
 * Pure rule definitions. Each rule takes a source file's content + path
 * and returns the violations it found. Stateless and synchronous so the
 * runner can compose them freely (CLI, devtools, editor extension).
 */

export interface Violation {
  ruleId: string
  severity: 'error' | 'warn'
  file: string
  /** 1-based line number of the offending construct. */
  line: number
  message: string
  suggestion?: string
}

export interface LintContext {
  source: string
  file: string
  /**
   * Whether the file lives inside `packages/<name>/src/` of the
   * `@forinda/kickjs-*` monorepo. First-party files are held to the
   * stricter `kick/` prefix; third-party adopter code is exempt.
   */
  firstParty: boolean
}

export interface Rule {
  id: string
  description: string
  defaultSeverity: 'error' | 'warn'
  check(ctx: LintContext): Violation[]
}

const SYMBOL_DECL_REGEX = /\bexport\s+const\s+([A-Z_][A-Z0-9_]*)\s*=\s*Symbol\s*\(/g
const CREATE_TOKEN_LITERAL_REGEX = /createToken\s*(?:<[^>]*>)?\s*\(\s*['"`]([^'"`]+)['"`]/g

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length
}

/**
 * Forbid `export const X = Symbol('...')` declarations in token-bearing
 * files. The §22 v4 migration replaced first-party DI tokens with
 * `createToken<T>()`; this rule blocks regression in framework code and
 * encourages adopters to follow the same pattern.
 *
 * Inline-disable: append `// kick-lint-disable di-token-symbol` to the
 * declaration line.
 */
export const diTokenSymbol: Rule = {
  id: 'di-token-symbol',
  description: 'DI tokens must use createToken<T>() instead of Symbol(...)',
  defaultSeverity: 'error',
  check({ source, file }) {
    const out: Violation[] = []
    const lines = source.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.includes('// kick-lint-disable di-token-symbol')) continue
      SYMBOL_DECL_REGEX.lastIndex = 0
      const match = SYMBOL_DECL_REGEX.exec(line)
      if (!match) continue
      out.push({
        ruleId: diTokenSymbol.id,
        severity: diTokenSymbol.defaultSeverity,
        file,
        line: i + 1,
        message: `\`${match[1]} = Symbol(...)\` declares a DI token via Symbol`,
        suggestion: `Use \`createToken<T>('kick/<area>/<key>')\` -- see architecture.md section 22`,
      })
    }
    return out
  },
}

/**
 * For first-party files, every `createToken('literal')` literal must
 * start with the reserved `kick/` prefix. Third-party adopter code is
 * exempt -- they use their own scope (`mycorp/`, `acme/`, etc.).
 *
 * Allowed back-compat exception: literals starting with `kickjs.` or
 * `kickjs/` (the dotted convention pre-dates section 22 and gets
 * migrated alongside the symbol-to-string work).
 */
export const tokenKickPrefix: Rule = {
  id: 'token-kick-prefix',
  description: 'First-party DI tokens must start with the reserved `kick/` prefix',
  defaultSeverity: 'error',
  check({ source, file, firstParty }) {
    if (!firstParty) return []
    const out: Violation[] = []
    CREATE_TOKEN_LITERAL_REGEX.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = CREATE_TOKEN_LITERAL_REGEX.exec(source)) !== null) {
      const literal = match[1]
      if (literal.startsWith('kick/')) continue
      if (literal.startsWith('kickjs.') || literal.startsWith('kickjs/')) continue
      out.push({
        ruleId: tokenKickPrefix.id,
        severity: tokenKickPrefix.defaultSeverity,
        file,
        line: lineOf(source, match.index),
        message: `\`createToken('${literal}')\` is missing the reserved \`kick/\` prefix`,
        suggestion: `Rename to \`'kick/${literal}'\` -- first-party tokens own the \`kick/\` namespace`,
      })
    }
    return out
  },
}

/**
 * Third-party adopters must NOT squat the reserved `kick/` prefix --
 * mirror image of {@link tokenKickPrefix}. Runs only on non-first-party
 * code and warns rather than errors so the rule is informative without
 * blocking adopter installs.
 */
export const tokenReservedPrefix: Rule = {
  id: 'token-reserved-prefix',
  description: 'Third-party tokens must not start with the reserved `kick/` prefix',
  defaultSeverity: 'warn',
  check({ source, file, firstParty }) {
    if (firstParty) return []
    const out: Violation[] = []
    CREATE_TOKEN_LITERAL_REGEX.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = CREATE_TOKEN_LITERAL_REGEX.exec(source)) !== null) {
      const literal = match[1]
      if (!literal.startsWith('kick/')) continue
      out.push({
        ruleId: tokenReservedPrefix.id,
        severity: tokenReservedPrefix.defaultSeverity,
        file,
        line: lineOf(source, match.index),
        message: `\`createToken('${literal}')\` squats the reserved \`kick/\` prefix`,
        suggestion: `Pick an org-scoped prefix instead (e.g. \`'mycorp/...'\`)`,
      })
    }
    return out
  },
}

/** All rules shipped by this package, in run order. */
export const rules: readonly Rule[] = [diTokenSymbol, tokenKickPrefix, tokenReservedPrefix]
