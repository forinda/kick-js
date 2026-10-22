/**
 * Form state from the request's session — what `@forinda/kickjs`'s `flash()`
 * and `formErrorHandler()` leave for the next page — as three request-wide
 * template names: `$errors`, `$old` and `$flash`. Read through the request
 * duck-typed, so this package never imports `@forinda/kickjs` at runtime.
 */

/** Session keys, the same as `@forinda/kickjs`'s `FLASH_KEY`, `FORM_ERRORS_KEY` and `OLD_INPUT_KEY`. */
export const FORM_STATE_KEYS = {
  flash: '__inertia_flash',
  errors: '__inertia_errors',
  old: '__kick_old',
} as const

/** Names every template sees, components included. */
export const FORM_GLOBALS: ReadonlySet<string> = new Set(['$errors', '$old', '$flash'])

type Bag = Record<string, unknown>

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
