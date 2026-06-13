/**
 * LIKE / ILIKE pattern safety helpers.
 *
 * User-supplied search text dropped straight into a `LIKE` pattern lets
 * the user inject wildcards: searching for `100%` matches everything,
 * `a_b` matches `axb`. Worse, a literal `%` from the user combined with a
 * leading wildcard (`%${input}%`) can blow up to a full scan. These
 * helpers escape the LIKE metacharacters so the input is matched
 * literally.
 *
 * Escapes `%`, `_`, and the escape character itself. The default escape
 * char is backslash, which Postgres and SQLite honour by default; MySQL
 * also defaults to backslash. When you build the query, pair the pattern
 * with the matching `ESCAPE '\'` clause if your dialect/collation needs
 * it explicit.
 */

export type LikeMatchMode = 'contains' | 'startsWith' | 'endsWith' | 'exact'

/**
 * Escape LIKE/ILIKE metacharacters in `input` so it matches literally.
 *
 * @example
 * ```ts
 * escapeLike('100%')        // '100\\%'
 * escapeLike('a_b\\c')      // 'a\\_b\\\\c'
 * ```
 */
export function escapeLike(input: string, escapeChar = '\\'): string {
  // The escape char must be exactly one character and not a wildcard
  // itself — `''` would be a no-op, `'%'`/`'_'` would over-escape and
  // corrupt the literal match. This is a safety primitive, so reject
  // bad config loudly rather than emit a silently-wrong pattern.
  if (escapeChar.length !== 1 || escapeChar === '%' || escapeChar === '_') {
    throw new Error("escapeLike: escapeChar must be a single character other than '%' or '_'")
  }
  // Escape the escape char first so we don't double-escape the
  // backslashes we add for % and _.
  const e = escapeChar
  return input
    .replaceAll(e, e + e)
    .replaceAll('%', e + '%')
    .replaceAll('_', e + '_')
}

/**
 * Build a literal-safe LIKE pattern from user input.
 *
 * @example
 * ```ts
 * likePattern('john%', 'contains')    // '%john\\%%'
 * likePattern('admin', 'startsWith')  // 'admin%'
 * db.selectFrom('users')
 *   .where('email', 'like', likePattern(ctx.qs().search, 'contains'))
 * ```
 */
export function likePattern(
  input: string,
  mode: LikeMatchMode = 'contains',
  escapeChar = '\\',
): string {
  const safe = escapeLike(input, escapeChar)
  switch (mode) {
    case 'contains':
      return `%${safe}%`
    case 'startsWith':
      return `${safe}%`
    case 'endsWith':
      return `%${safe}`
    case 'exact':
      return safe
    default: {
      // Compile-time exhaustiveness + a runtime guard for JS callers /
      // `as any` that pass an unsupported mode (would otherwise return
      // undefined despite the `: string` signature).
      const _exhaustive: never = mode
      throw new Error(`likePattern: unsupported match mode ${String(_exhaustive)}`)
    }
  }
}
