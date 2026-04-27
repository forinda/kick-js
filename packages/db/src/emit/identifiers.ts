export function quoteIdent(name: string): string {
  return name
    .split('.')
    .map((part) => '"' + part.replace(/"/g, '""') + '"')
    .join('.')
}

export function quoteLiteral(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'"
}
