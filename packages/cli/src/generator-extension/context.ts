import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { toPascalCase, toCamelCase, toKebabCase, pluralize } from '../utils/naming'
import type { GeneratorContext } from './define'

/** Convert any string to snake_case (`UserPost` / `user-post` → `user_post`). */
function toSnakeCase(name: string): string {
  return toKebabCase(name).replace(/-/g, '_')
}

/**
 * Build a {@link GeneratorContext} from the raw name + invocation
 * arguments. Centralises the case-transformation logic so every plugin
 * generator sees the same shape regardless of how the name was typed
 * on the command line (`Post` vs `post` vs `user_post`).
 */
export function buildGeneratorContext(input: {
  name: string
  args?: string[]
  flags?: Record<string, string | boolean>
  modulesDir?: string
  cwd?: string
  pluralize?: boolean
}): GeneratorContext {
  const cwd = input.cwd ?? process.cwd()
  const usePlural = input.pluralize ?? true

  const pascal = toPascalCase(input.name)
  const camel = toCamelCase(input.name)
  const kebab = toKebabCase(input.name)
  const snake = toSnakeCase(input.name)

  const ctx: GeneratorContext = {
    name: input.name,
    pascal,
    camel,
    kebab,
    snake,
    modulesDir: input.modulesDir ?? 'src/modules',
    cwd,
    args: input.args ?? [],
    flags: input.flags ?? {},
  }

  if (usePlural) {
    const pluralKebab = pluralize(kebab)
    ctx.pluralKebab = pluralKebab
    ctx.pluralPascal = toPascalCase(pluralKebab)
    ctx.pluralCamel = toCamelCase(pluralKebab)
  }

  return ctx
}

/** Resolve a generator output path against the context's cwd. */
export function resolveGeneratorPath(ctx: GeneratorContext, path: string): string {
  return resolve(ctx.cwd, path)
}

/**
 * Dynamic-import a generator manifest file. Wraps `pathToFileURL` so
 * callers don't have to think about Windows/Unix path quirks.
 */
export async function importManifest(absPath: string): Promise<unknown> {
  return import(pathToFileURL(absPath).href)
}
