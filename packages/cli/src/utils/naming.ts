/** Convert a name to PascalCase */
export function toPascalCase(name: string): string {
  return name
    .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
    .replace(/^(.)/, (c) => c.toUpperCase())
}

/** Convert a name to camelCase */
export function toCamelCase(name: string): string {
  const pascal = toPascalCase(name)
  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}

/** Convert a name to kebab-case */
export function toKebabCase(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase()
}

/**
 * Pluralize a kebab-case name for directory/file names.
 * If already plural (ends in 's'), returns as-is.
 */
export function pluralize(name: string): string {
  if (name.endsWith('s')) return name
  if (name.endsWith('x') || name.endsWith('z')) return name + 'es'
  if (name.endsWith('sh') || name.endsWith('ch')) return name + 'es'
  if (name.endsWith('y') && !/[aeiou]y$/.test(name)) return name.slice(0, -1) + 'ies'
  return name + 's'
}

/**
 * Pluralize a PascalCase name for class identifiers.
 * If already plural (ends in 's'), returns as-is.
 * Used for `List${pluralPascal}UseCase` to avoid `ListUserssUseCase`.
 */
export function pluralizePascal(name: string): string {
  if (name.endsWith('s')) return name
  if (name.endsWith('x') || name.endsWith('z')) return name + 'es'
  if (name.endsWith('sh') || name.endsWith('ch')) return name + 'es'
  if (name.endsWith('y') && !/[aeiou]y$/i.test(name)) return name.slice(0, -1) + 'ies'
  return name + 's'
}
