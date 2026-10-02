/**
 * Group queries that differ only in their values: placeholders, numbers and
 * string literals become `?`, `IN (?, ?, ?)` becomes `IN (?)`, and
 * whitespace collapses. Pure, so it's unit-tested.
 */
export function normalizeSql(sql: string): string {
  return sql
    .replace(/'(?:[^']|'')*'/g, '?') // 'string literals'
    .replace(/\$\d+|:\w+|@\w+/g, '?') // $1, :name, @name placeholders
    .replace(/\b\d+(?:\.\d+)?\b/g, '?') // numbers
    .replace(/\(\s*\?(?:\s*,\s*\?)+\s*\)/g, '(?)') // IN (?, ?, ?)
    .replace(/\s+/g, ' ')
    .trim()
}
