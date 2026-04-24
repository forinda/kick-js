import { join } from 'node:path'
import { writeFileSafe } from '../utils/fs'
import { toPascalCase, toKebabCase } from '../utils/naming'

interface GenerateAdapterOptions {
  name: string
  outDir: string
}

/**
 * Scaffold a `defineAdapter()` factory under `src/adapters/<name>.adapter.ts`.
 *
 * v4 dropped the `class implements AppAdapter` pattern in favour of the
 * `defineAdapter()` factory (architecture.md §21.3.4). The generated
 * template uses the new factory shape so adopters get a working
 * adapter with all four lifecycle hooks (beforeMount, beforeStart,
 * afterStart, shutdown), a typed config object with defaults, and the
 * factory's call / `.scoped()` / `.async()` surfaces — without
 * writing a single class.
 */
export async function generateAdapter(options: GenerateAdapterOptions): Promise<string[]> {
  const { name, outDir } = options
  const kebab = toKebabCase(name)
  const pascal = toPascalCase(name)
  const files: string[] = []

  const filePath = join(outDir, `${kebab}.adapter.ts`)
  await writeFileSafe(
    filePath,
    `import { defineAdapter, type AdapterContext, type AdapterMiddleware } from '@forinda/kickjs'

/**
 * Configuration for the ${pascal} adapter.
 *
 * Adapters typically take a small config object so callers can tune
 * behaviour at bootstrap time. Keep the shape narrow — anything
 * derived from the environment should be read inside the build
 * function via getEnv(), not forced onto the caller.
 */
export interface ${pascal}AdapterConfig {
  // Add your adapter configuration here, e.g.:
  // enabled?: boolean
  // apiKey?: string
}

/**
 * ${pascal} adapter — built via \`defineAdapter()\` so callers get the
 * factory's call / \`.scoped()\` / \`.async()\` surfaces for free.
 *
 * Hooks into the Application lifecycle to add middleware, routes,
 * or external service connections.
 *
 * @example
 * \`\`\`ts
 * import { bootstrap } from '@forinda/kickjs'
 * import { ${pascal}Adapter } from './adapters/${kebab}.adapter'
 *
 * bootstrap({
 *   modules,
 *   adapters: [${pascal}Adapter({ /* config overrides *\\/ })],
 * })
 * \`\`\`
 */
export const ${pascal}Adapter = defineAdapter<${pascal}AdapterConfig>({
  name: '${pascal}Adapter',
  defaults: {
    // Default config values go here
  },
  build: (_config, { name: _name }) => ({
    /**
     * Return middleware entries that the Application will mount.
     * \`phase\` controls where in the pipeline they run:
     * 'beforeGlobal' | 'afterGlobal' | 'beforeRoutes' | 'afterRoutes'.
     */
    middleware(): AdapterMiddleware[] {
      return [
        // Example: add a custom header to all responses
        // {
        //   phase: 'beforeGlobal',
        //   handler: (_req, res, next) => {
        //     res.setHeader('X-${pascal}', 'true')
        //     next()
        //   },
        // },
      ]
    },

    /**
     * Called before global middleware. Use this to mount routes that
     * bypass the middleware stack (health checks, docs UI, static
     * assets).
     */
    beforeMount(_ctx: AdapterContext): void {
      // Example:
      // _ctx.app.get('/${kebab}/status', (_req, res) => res.json({ status: 'ok' }))
    },

    /**
     * Called after modules and routes are registered, before the
     * server starts. Use this for late-stage DI registrations or
     * config validation.
     */
    beforeStart(_ctx: AdapterContext): void {
      // Example: _ctx.container.bindToken(MY_TOKEN, new MyService(_config))
    },

    /**
     * Called after the HTTP server is listening. Use this to attach
     * to the raw http.Server (Socket.IO, gRPC, etc).
     */
    afterStart(_ctx: AdapterContext): void {
      // Example: const io = new Server(_ctx.server)
    },

    /** Called on graceful shutdown. Clean up connections. */
    async shutdown(): Promise<void> {
      // Example: await this.pool.end()
    },
  }),
})
`,
  )
  files.push(filePath)

  return files
}
