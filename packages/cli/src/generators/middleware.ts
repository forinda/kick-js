import { join } from 'node:path'
import { writeFileSafe } from '../utils/fs'
import { toPascalCase, toKebabCase, toCamelCase } from '../utils/naming'
import { resolveOutDir } from '../utils/resolve-out-dir'
import type { ProjectPattern } from '../config'

interface GenerateMiddlewareOptions {
  name: string
  outDir?: string
  moduleName?: string
  modulesDir?: string
  pattern?: ProjectPattern
  pluralize?: boolean
}

export async function generateMiddleware(options: GenerateMiddlewareOptions): Promise<string[]> {
  const { name, moduleName, modulesDir, pattern } = options
  const outDir = resolveOutDir({
    type: 'middleware',
    outDir: options.outDir,
    moduleName,
    modulesDir,
    defaultDir: 'src/middleware',
    pattern,
    shouldPluralize: options.pluralize ?? true,
  })
  const kebab = toKebabCase(name)
  const camel = toCamelCase(name)
  const files: string[] = []

  const filePath = join(outDir, `${kebab}.middleware.ts`)
  await writeFileSafe(
    filePath,
    `import type { Request, Response, NextFunction } from 'express'

export interface ${toPascalCase(name)}Options {
  // Add configuration options here
}

/**
 * ${toPascalCase(name)} middleware.
 *
 * Usage in bootstrap:
 *   middleware: [${camel}()]
 *
 * Usage with adapter:
 *   middleware() { return [{ handler: ${camel}(), phase: 'afterGlobal' }] }
 *
 * Usage with @Middleware decorator:
 *   @Middleware(${camel}())
 */
export function ${camel}(options: ${toPascalCase(name)}Options = {}) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Implement your middleware logic here
    next()
  }
}
`,
  )
  files.push(filePath)

  return files
}
