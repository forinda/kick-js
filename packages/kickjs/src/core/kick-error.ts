/**
 * Structured framework error with code, cause, and actionable fix hint.
 *
 * The goal is "the developer who hits this knows what to do next." A
 * cryptic `Error('No binding found for: UserService')` becomes a
 * multi-line explanation pointing at the likely cause, the exact code
 * change to apply, and a docs link.
 *
 * `.message` carries the full multi-line plain-text body so Node's
 * default `Error.toString()` and unhandled-exception printing still
 * surface the helpful version. Call {@link formatKickError} to render a
 * colorized version for terminals.
 *
 * Per-error factories live in `kick-errors.ts` — those are the public
 * entry points framework code uses. `KickError` is exported so adopters
 * can build their own structured errors using the same shape.
 */
export interface KickErrorInit {
  /** Short stable identifier (e.g. `KICK001`, `NO_PROVIDER`). */
  code: string
  /** One-line headline. */
  summary: string
  /** Multi-line explanation of why this happened. */
  cause?: string
  /** Multi-line actionable fix — show exact code if possible. */
  fix?: string
  /** Absolute URL to the docs page that covers this error. */
  docsUrl?: string
  /** Arbitrary structured fields for log consumers / debug tooling. */
  context?: Record<string, unknown>
}

export class KickError extends Error {
  public readonly code: string
  public readonly summary: string
  public readonly cause?: string
  public readonly fix?: string
  public readonly docsUrl?: string
  public readonly context?: Record<string, unknown>

  constructor(init: KickErrorInit) {
    super(formatKickError(init, { color: false }))
    this.name = 'KickError'
    this.code = init.code
    this.summary = init.summary
    if (init.cause !== undefined) this.cause = init.cause
    if (init.fix !== undefined) this.fix = init.fix
    if (init.docsUrl !== undefined) this.docsUrl = init.docsUrl
    if (init.context !== undefined) this.context = init.context
  }
}

// ── ANSI colour helpers ────────────────────────────────────────────────

/**
 * `true` when the runtime can render ANSI escape codes on stderr.
 * Honors `NO_COLOR` (https://no-color.org) and `FORCE_COLOR`.
 */
function ansiEnabled(): boolean {
  if (process.env.NO_COLOR) return false
  if (process.env.FORCE_COLOR) return true
  // Node sets `isTTY` on the writable streams when stdout/stderr is a
  // terminal. KickError output goes to stderr conceptually (it's an
  // error), so we follow that stream's affordances.
  return process.stderr?.isTTY === true
}

// Use the Unicode-escape form (``) rather than the hex-escape (`\x1b`)
// for the ANSI ESC byte — both produce the same character, but oxlint's
// `no-control-character` rule flags the hex form as "unexpected control
// character in string literal". Functionally identical, lint-clean.
const ESC = '['
const RESET = `${ESC}0m`

function paint(text: string, code: string, enabled: boolean): string {
  return enabled ? `${ESC}${code}m${text}${RESET}` : text
}

const c = {
  red: (s: string, enabled: boolean) => paint(s, '31', enabled),
  bold: (s: string, enabled: boolean) => paint(s, '1', enabled),
  dim: (s: string, enabled: boolean) => paint(s, '2', enabled),
  cyan: (s: string, enabled: boolean) => paint(s, '36', enabled),
  blue: (s: string, enabled: boolean) => paint(s, '34', enabled),
  underline: (s: string, enabled: boolean) => paint(s, '4', enabled),
}

// ── Formatter ─────────────────────────────────────────────────────────

export interface FormatKickErrorOptions {
  /**
   * Render ANSI colour codes. Defaults to TTY detection (`NO_COLOR` /
   * `FORCE_COLOR` env vars honoured). Pass `false` for log files,
   * structured loggers, or HTTP response bodies.
   */
  color?: boolean
}

/**
 * Render a {@link KickErrorInit} (or {@link KickError} instance) into a
 * multi-line human-readable string. Identical layout regardless of
 * colour — the colour flag only toggles ANSI codes.
 */
export function formatKickError(
  err: KickErrorInit | KickError,
  options: FormatKickErrorOptions = {},
): string {
  const color = options.color ?? ansiEnabled()
  const lines: string[] = []

  // Headline: `KICK001: No provider for UserService`
  const code = c.bold(c.red(err.code, color), color)
  lines.push(`${code}: ${err.summary}`)

  if (err.cause) {
    lines.push('', `  ${c.bold(c.dim('Cause:', color), color)}`)
    for (const line of err.cause.split('\n')) {
      lines.push(`    ${highlightInline(line, color)}`)
    }
  }

  if (err.fix) {
    lines.push('', `  ${c.bold(c.dim('Fix:', color), color)}`)
    for (const line of err.fix.split('\n')) {
      lines.push(`    ${highlightInline(line, color)}`)
    }
  }

  if (err.docsUrl) {
    lines.push('', `  ${c.bold(c.dim('Docs:', color), color)}`)
    lines.push(`    ${c.underline(c.blue(err.docsUrl, color), color)}`)
  }

  return lines.join('\n')
}

/**
 * Highlight inline `code spans` in a line of cause/fix text. Anything
 * between backticks gets cyan when colour is enabled; backticks stay
 * in the output so the plain-text rendering still distinguishes
 * literals.
 */
function highlightInline(line: string, color: boolean): string {
  if (!color) return line
  return line.replace(/`([^`]+)`/g, (_, inner: string) => `\`${c.cyan(inner, true)}\``)
}
