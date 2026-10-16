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
