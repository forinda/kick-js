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
/** The last full page this session rendered: where a failed form goes back to. */
export const PREVIOUS_URL_KEY = '__inertia_previous'

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
  // No prototype: a field named `constructor` or `__proto__` is just a field.
  const errors: Record<string, string> = Object.create(null)
  for (const d of details as Array<{ field?: string; message?: string }>) {
    const field = d.field || 'form'
    if (!Object.hasOwn(errors, field)) errors[field] = d.message ?? 'Invalid value'
  }
  return errors
}

/**
 * Names never carried to the next page, nor refilled: passwords, PINs,
 * one-time codes, tokens, card details. `@forinda/kickjs-view` uses the same
 * rule for refilling.
 */
export const SECRET_FIELD =
  /pass(word|code)?|passwd|pwd|secret|token|card|cvv|cvc|csrf|otp|(^|[_-])pin($|[_-])/i

const bytes = (s: string) => new TextEncoder().encode(s).length

/**
 * What a failed submit sent, for refilling the form: string values (and
 * lists of them), leaving out secrets, files and fields over `limits.field`
 * bytes. `undefined` when the whole is over `limits.total` bytes of JSON — a cookie session can't hold it, and losing the session would
 * log the user out.
 */
export function oldInput(
  body: unknown,
  limits: { field?: number; total?: number } = {},
): Record<string, string | string[]> | undefined {
  const field = limits.field ?? 1000
  // Bytes of UTF-8, before the session encrypts and encodes it (a third
  // more): leaves room in a 4 KB cookie for the errors and the rest.
  const total = limits.total ?? 1500
  const out: Record<string, string | string[]> = Object.create(null)
  if (!body || typeof body !== 'object') return out
  for (const [name, value] of Object.entries(body)) {
    if (SECRET_FIELD.test(name)) continue
    if (typeof value === 'string') {
      if (bytes(value) <= field) out[name] = value
    } else if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
      if (bytes(value.join('')) <= field) out[name] = value
    }
  }
  return bytes(JSON.stringify(out)) > total ? undefined : out
}
