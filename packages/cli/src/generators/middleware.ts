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
  // Add configuration options here. The factory below closes over the
  // resolved options object; pass them at the call site —
  // \`${camel}({ foo: 'bar' })\` — and the closure preserves them across
  // every request.
}

/**
 * ${toPascalCase(name)} middleware.
 *
 * Usage in bootstrap (fires on every request):
 *   middleware: [${camel}()]
 *
 * Usage with adapter — phase controls *when* the handler runs:
 *
 *   middleware() {
 *     return [{ handler: ${camel}(), phase: 'afterGlobal' }]
 *   }
 *
 * Phase semantics (see \`MiddlewarePhase\` JSDoc for the full contract):
 *   - 'beforeGlobal' / 'afterGlobal' / 'beforeRoutes' — fire on every
 *     request, before module routes run.
 *   - 'afterRoutes' — fires ONLY when no route matched (404 fall-through)
 *     OR a route handler called \`next()\` without ending the response.
 *     Controllers that call \`ctx.json(…)\` end the chain and skip this
 *     phase. For per-response work (logging, metrics) attach to
 *     \`res.on('finish', …)\` from an earlier-phase middleware instead.
 *
 * Optional path scope — string, RegExp, or array of either:
 *   middleware() {
 *     return [{
 *       handler: ${camel}({ region: 'eu' }),
 *       phase: 'afterGlobal',
 *       path: ['/api', /^\\/admin/],
 *     }]
 *   }
 *
 * Usage with @Middleware decorator:
 *   @Middleware(${camel}())
 */
export function ${camel}(options: ${toPascalCase(name)}Options = {}) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Implement your middleware logic here. \`options\` is captured by
    // closure — log or read it anywhere in this handler body.
    void options
    next()
  }
}
`,
  )
  files.push(filePath)

  return files
}
