/**
 * Split a SQL blob into individual statements at the top-level `;`
 * boundary. Respects single-quote / double-quote / backtick string
 * literals AND `--` line comments + C-style block comments —
 * `;` inside any of those does not terminate a statement.
 *
 * Drivers that run one statement per call (mysql2 without
 * `multipleStatements`, libsql's `execute`, D1's `prepare`) need the
 * migration SQL kick/db emits split this way.
 *
 * Dialect differences:
 *
 *   - **MySQL `--` comments require trailing whitespace/end-of-input**
 *     (`5--3` is two unary minuses). In SQLite `--` always starts one.
 *   - **Backslash escapes** (`'it\\'s'`) exist in MySQL only; both accept
 *     the SQL-standard doubled quote (`'it''s'`).
 *
 * Hand-written SQL with pathological input — `;` in an unterminated block
 * comment, or a SQLite trigger body (`BEGIN … ; … END`) — won't split
 * correctly.
 */
export function splitSqlStatements(sql: string, dialect: 'mysql' | 'sqlite'): string[] {
  const backslashEscapes = dialect === 'mysql'
  const out: string[] = []
  let buf = ''
  let inSingle = false
  let inDouble = false
  let inBacktick = false
  let inLineComment = false
  let inBlockComment = false

  const isCommentWhitespace = (c: string) =>
    c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v'

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    const next = i + 1 < sql.length ? sql[i + 1] : ''
    const after = i + 2 < sql.length ? sql[i + 2] : ''

    if (inLineComment) {
      buf += ch
      if (ch === '\n') inLineComment = false
      continue
    }
    if (inBlockComment) {
      buf += ch
      if (ch === '*' && next === '/') {
        buf += next
        i++
        inBlockComment = false
      }
      continue
    }
    if (inSingle) {
      // Doubled `''` is an SQL-standard escape — stay in-string.
      if (ch === "'" && next === "'") {
        buf += ch
        buf += next
        i++
        continue
      }
      buf += ch
      if (backslashEscapes && ch === '\\' && next !== '') {
        buf += next
        i++
        continue
      }
      if (ch === "'") inSingle = false
      continue
    }
    if (inDouble) {
      // Doubled `""` is an SQL-standard escape — stay in-string.
      if (ch === '"' && next === '"') {
        buf += ch
        buf += next
        i++
        continue
      }
      buf += ch
      if (backslashEscapes && ch === '\\' && next !== '') {
        buf += next
        i++
        continue
      }
      if (ch === '"') inDouble = false
      continue
    }
    if (inBacktick) {
      buf += ch
      if (ch === '`') inBacktick = false
      continue
    }

    // `--` is a comment introducer only when followed by whitespace
    // (or end-of-input). Anything else (`5--3`, `--xyz`) is left as
    // operator-soup and the driver decides what to do with it.
    if (
      ch === '-' &&
      next === '-' &&
      (dialect === 'sqlite' || after === '' || isCommentWhitespace(after))
    ) {
      buf += ch
      inLineComment = true
      continue
    }
    if (ch === '/' && next === '*') {
      buf += ch
      inBlockComment = true
      continue
    }
    if (ch === "'") {
      buf += ch
      inSingle = true
      continue
    }
    if (ch === '"') {
      buf += ch
      inDouble = true
      continue
    }
    if (ch === '`') {
      buf += ch
      inBacktick = true
      continue
    }
    if (ch === ';') {
      const trimmed = buf.trim()
      if (trimmed.length > 0) out.push(trimmed)
      buf = ''
      continue
    }
    buf += ch
  }

  const tail = buf.trim()
  if (tail.length > 0) out.push(tail)
  return out
}
