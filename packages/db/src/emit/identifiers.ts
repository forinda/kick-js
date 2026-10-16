export function quoteIdent(name: string): string {
  return name
    .split('.')
    .map((part) => '"' + part.replace(/"/g, '""') + '"')
    .join('.')
}

export function quoteLiteral(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'"
}

/**
 * Whether a column of this type can take a default that is an expression —
 * a number, a boolean, a function call. On any other type (text, varchar, an
 * enum) a default is always a literal: `'0800'` stays a string and `'true'`
 * stays the word, however they look.
 */
export function allowsExpressionDefault(type: string): boolean {
  const base = type.endsWith('[]') ? type.slice(0, -2) : type
  return /^(smallint|integer|int|int2|int4|int8|bigint|serial|bigserial|smallserial|real|float4|float8|double precision|numeric|decimal|money|bool|boolean|timestamp|timestamptz|date|time|timetz|interval|uuid)\b/i.test(
    base,
  )
}

/**
 * Whether a default is one function call, arguments and all: `now()`,
 * `floor(rand() * 10)`, `nextval('a(b'::regclass)`. The call's closing
 * parenthesis has to end the string, so `a() + b()` isn't one; parentheses
 * inside quoted strings don't count.
 */
export function isFunctionCall(str: string): boolean {
  const open = /^[a-z_][a-z0-9_]*\s*\(/i.exec(str)
  if (!open) return false
  let depth = 0
  let quoted = false
  for (let i = open[0].length - 1; i < str.length; i++) {
    const ch = str[i]
    if (quoted) {
      // '' inside a string is a quote, not its end.
      if (ch === "'") {
        if (str[i + 1] === "'") i++
        else quoted = false
      }
      continue
    }
    if (ch === "'") quoted = true
    else if (ch === '(') depth++
    else if (ch === ')' && --depth === 0) return i === str.length - 1
  }
  return false
}
