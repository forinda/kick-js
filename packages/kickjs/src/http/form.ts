/**
 * Form state that outlives a redirect: flash messages, field errors and the
 * values a failed submit sent, kept in the session for the next page. The
 * keys and shapes are the ones `@forinda/kickjs-inertia` uses, so `flash()`
 * works the same for Inertia pages and `.kick` views.
 *
 * @module @forinda/kickjs/http/form
 */

export const FLASH_KEY = '__inertia_flash'
export const FORM_ERRORS_KEY = '__inertia_errors'
export const OLD_INPUT_KEY = '__kick_old'

interface WithSession {
  session?: { data: Record<string, unknown> }
}

/** Flash data for the next page, merged with any already set. */
export function flash(ctx: WithSession, data: Record<string, unknown>): void {
  const session = ctx.session
  if (!session) throw new Error('flash() needs the session() middleware.')
  session.data[FLASH_KEY] = { ...(session.data[FLASH_KEY] as object), ...data }
}

/** `[{ field, message }]` from route validation → `{ field: firstMessage }`; `'form'` for the body as a whole. */
export function fieldErrors(details: unknown): Record<string, string> | null {
  if (!Array.isArray(details)) return null
  const errors: Record<string, string> = {}
  for (const d of details as Array<{ field?: string; message?: string }>) {
    errors[d.field || 'form'] ??= d.message ?? 'Invalid value'
  }
  return errors
}

/** Names never carried to the next page. */
const SECRET = /pass(word)?|passwd|secret|token|card|cvv|cvc|csrf/i

/**
 * What a failed submit sent, for refilling the form: string values (and
 * lists of them), leaving out secrets, files and fields over `limits.field`
 * characters. `undefined` when the whole is over `limits.total` characters
 * of JSON — a cookie session can't hold it, and losing the session would
 * log the user out.
 */
export function oldInput(
  body: unknown,
  limits: { field?: number; total?: number } = {},
): Record<string, string | string[]> | undefined {
  const field = limits.field ?? 1000
  const total = limits.total ?? 2000
  const out: Record<string, string | string[]> = {}
  if (!body || typeof body !== 'object') return out
  for (const [name, value] of Object.entries(body)) {
    if (SECRET.test(name)) continue
    if (typeof value === 'string') {
      if (value.length <= field) out[name] = value
    } else if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
      if (value.join('').length <= field) out[name] = value
    }
  }
  return JSON.stringify(out).length > total ? undefined : out
}
