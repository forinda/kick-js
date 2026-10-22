/**
 * Form state from the request's session — what `@forinda/kickjs`'s `flash()`
 * and `formErrorHandler()` leave for the next page — as three request-wide
 * template names: `$errors`, `$old` and `$flash`. Read through the request
 * duck-typed, so this package never imports `@forinda/kickjs` at runtime.
 */

type Bag = Record<string, unknown>

/** Session keys, the same as `@forinda/kickjs`'s `FLASH_KEY`, `FORM_ERRORS_KEY`, `OLD_INPUT_KEY` and `PREVIOUS_URL_KEY`. */
export const FORM_STATE_KEYS = {
  flash: '__inertia_flash',
  errors: '__inertia_errors',
  old: '__kick_old',
  previous: '__inertia_previous',
} as const

/** Names never refilled — the same rule as `@forinda/kickjs`'s `SECRET_FIELD`. */
export const SECRET_FIELD =
  /pass(word|code)?|passwd|pwd|secret|token|card|cvv|cvc|csrf|otp|(^|[_-])pin($|[_-])/i

/**
 * Remember a full page a GET rendered, so a failed form post goes back to it
 * (`formErrorHandler()` reads it): browsers send no Referer under helmet's
 * default `no-referrer` policy. Partials (`layout: false`) aren't pages.
 */
export function rememberPage(ctx: unknown, layout: boolean | string | undefined): void {
  if (layout === false) return
  const c = ctx as
    | { req?: { method?: string; url?: string; originalUrl?: string }; session?: { data?: Bag } }
    | undefined
  const data = c?.session?.data
  const method = String(c?.req?.method ?? '').toUpperCase()
  const url = c?.req?.originalUrl ?? c?.req?.url
  if (data && method === 'GET' && typeof url === 'string') data[FORM_STATE_KEYS.previous] = url
}

/** Names every template sees, components included. */
export const FORM_GLOBALS: ReadonlySet<string> = new Set(['$errors', '$old', '$flash'])

/** The form state for this render, taken from the session so it shows once. */
export function takeFormState(ctx: unknown): { $errors: Bag; $old: Bag; $flash: Bag } {
  const data = (ctx as { session?: { data?: Bag } } | undefined)?.session?.data
  const take = (key: string): Bag => {
    if (!data || data[key] === undefined) return {}
    const value = data[key]
    delete data[key]
    return value && typeof value === 'object' ? (value as Bag) : {}
  }
  return {
    $errors: take(FORM_STATE_KEYS.errors),
    $old: take(FORM_STATE_KEYS.old),
    $flash: take(FORM_STATE_KEYS.flash),
  }
}
