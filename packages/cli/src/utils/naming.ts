import pkg from 'pluralize'

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
 * Uses the `pluralize` npm package for correct English pluralization
 * including irregulars (person → people, status → statuses, child → children).
 */
export function pluralize(name: string): string {
  return pkg.plural(name)
}

/**
 * Pluralize a PascalCase name for class identifiers.
 * Used for `List${pluralPascal}UseCase` to avoid `ListUserssUseCase`.
 */
export function pluralizePascal(name: string): string {
  return pkg.plural(name)
}
