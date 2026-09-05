import { join } from 'node:path'
import { writeFileSafe } from '../utils/fs'
import { toPascalCase, toKebabCase, toCamelCase } from '../utils/naming'
import { resolveOutDir } from '../utils/resolve-out-dir'
import type { KickConfig, ProjectPattern } from '../config'

interface GenerateMiddlewareOptions {
  name: string
  outDir?: string
  moduleName?: string
  modulesDir?: string
  pattern?: ProjectPattern
  pluralize?: boolean
  /**
   * The engine from `kick.config.ts`. Global middleware is connect-style on
   * every runtime, but only Express hands the handler an `express.Request` —
   * Fastify passes `request.raw` and h3 the node objects, so `node:http` is
   * the honest type there (and those projects have no `express` dependency to
   * import types from).
   */
  runtime?: KickConfig['runtime']
}

export async function generateMiddleware(options: GenerateMiddlewareOptions): Promise<string[]> {
  const { name, moduleName, modulesDir, pattern } = options
  // Explicit opt-in, not a fallback: an unset `runtime` means a hand-written or
  // pre-`--runtime` kick.config, which says nothing about the engine. Emitting
  // express types there is how the original bug shipped — `express` isn't a
  // dependency on a Fastify / h3 scaffold, so the import fails to compile.
  // `kick new` always writes the field, so real Express projects still opt in.
  const isExpress = options.runtime === 'express'
  // An unset `runtime` is a hand-written or pre-`--runtime` kick.config, so the
  // comment must not claim the project runs on one.
  const engineClause = options.runtime
    ? `this project runs on ${options.runtime} and has no
  // \`express\``
    : `this project declares no \`runtime\` in kick.config.ts, so it
  // may have no \`express\``
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
    `${
      isExpress
        ? `import type { Request, Response, NextFunction } from 'express'`
        : `import type { IncomingMessage, ServerResponse } from 'node:http'`
    }

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
 *   middlewares: [${camel}()]
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
 * NOT for \`@Middleware()\`. That decorator takes a ctx-style handler —
 * \`(ctx, next)\`, see \`MiddlewareHandler\` — and the runtime calls it with
 * exactly two arguments. Passing this connect-style factory there binds
 * \`next\` to the response slot and passes no third argument at all, so the
 * first \`next()\` throws \`TypeError: next is not a function\`. Generate a
 * guard instead (\`kick g guard\`) for the per-route, ctx-style shape.
 */
export function ${camel}(options: ${toPascalCase(name)}Options = {}) {
${
  isExpress
    ? `  // Typed from \`express\` because that is this project's runtime
  // (\`runtime: 'express'\` in kick.config.ts). Global middleware is
  // connect-style on every engine, but only Express hands the handler its own
  // request / response objects — so \`req.originalUrl\`, \`req.query\` and
  // \`res.json()\` are all available here. Switching \`runtime\` later means
  // re-typing this signature from \`node:http\`.
  return (req: Request, res: Response, next: NextFunction) => {`
    : `  // Typed from \`node:http\`, not \`express\`. Global middleware is connect-style
  // on every engine, but ${engineClause} dependency to import types from. Under Fastify the handler
  // receives \`request.raw\` / a reply driver, and under h3 the node objects, so
  // anything Express-only (\`req.originalUrl\`, \`res.json\`) is absent. Reach
  // for \`ctx.*\` helpers when you need a typed response.
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {`
}
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
