import { join } from 'node:path'
import { writeFileSafe } from '../utils/fs'
import { toPascalCase, toKebabCase } from '../utils/naming'

interface GeneratePluginOptions {
  name: string
  outDir: string
}

/**
 * Scaffold a `definePlugin()` factory under `src/plugins/<name>.plugin.ts`.
 *
 * v4 standardised on the `definePlugin()` factory pattern (architecture
 * §21.2.2) — same surface as `defineAdapter()`, so adopters learn one
 * mental model. The generated template uses the factory shape with a
 * typed config object, defaults block, and a build function returning
 * the underlying KickPlugin hooks.
 */
export async function generatePlugin(options: GeneratePluginOptions): Promise<string[]> {
  const { name, outDir } = options
  const kebab = toKebabCase(name)
  const pascal = toPascalCase(name)
  const files: string[] = []

  const filePath = join(outDir, `${kebab}.plugin.ts`)
  await writeFileSafe(
    filePath,
    `import {
  definePlugin,
  type AppAdapter,
  type AppModuleClass,
  type Container,
} from '@forinda/kickjs'

/**
 * Configuration for the ${pascal} plugin.
 *
 * Plugins typically take a small config object so callers can tune
 * behaviour at bootstrap time. Keep the shape narrow — anything
 * derived from the environment should be read inside the build
 * function via getEnv(), not forced onto the caller.
 */
export interface ${pascal}PluginConfig {
  // Add your plugin config here, e.g.:
  // enabled?: boolean
  // apiKey?: string
}

/**
 * ${pascal} plugin — built via \`definePlugin()\` so callers get the
 * factory's call / \`.scoped()\` / \`.async()\` surfaces for free.
 *
 * A plugin bundles DI bindings, modules, adapters, and middleware
 * into one object that can be added to \`bootstrap({ plugins })\`.
 *
 * Lifecycle order (each hook is optional — delete the ones you don't
 * need and keep only the surface your plugin actually uses):
 *
 *   1. \`register(container)\` — runs before user modules load. Use
 *      it to bind services that modules depend on.
 *   2. \`modules()\`            — plugin modules load before user modules.
 *   3. \`adapters()\`           — plugin adapters mount before user adapters.
 *   4. \`middleware()\`         — plugin middleware runs before user middleware.
 *   5. \`onReady(container)\`   — runs after the app has fully bootstrapped.
 *   6. \`shutdown()\`           — runs on graceful shutdown.
 *
 * @example
 * \`\`\`ts
 * import { bootstrap } from '@forinda/kickjs'
 * import { ${pascal}Plugin } from './plugins/${kebab}.plugin'
 *
 * export const app = await bootstrap({
 *   modules,
 *   plugins: [${pascal}Plugin({ /* config overrides *\\/ })],
 * })
 * \`\`\`
 */
export const ${pascal}Plugin = definePlugin<${pascal}PluginConfig>({
  name: '${pascal}Plugin',
  defaults: {
    // Default config values go here
  },
  build: (_config, { name: _name }) => ({
    /**
     * Register DI bindings before modules load.
     * Use \`container.registerInstance(TOKEN, value)\` for singletons
     * and \`container.registerFactory(TOKEN, () => ...)\` for lazy
     * constructions.
     */
    register(_container: Container): void {
      // Example: _container.registerInstance(MY_TOKEN, new MyService(_config))
    },

    /**
     * Return module classes this plugin contributes to the app.
     * These load before user modules, so plugin controllers and
     * services are available for user code to \`@Autowired\`.
     */
    modules(): AppModuleClass[] {
      return [
        // ExampleModule,
      ]
    },

    /**
     * Return adapter instances to be added to the application.
     * Plugin adapters mount before user adapters.
     */
    adapters(): AppAdapter[] {
      return [
        // MyAdapter({ ... }),
      ]
    },

    /**
     * Return Express middleware entries to be added to the global
     * pipeline. Plugin middleware runs before user-defined middleware.
     */
    middleware(): unknown[] {
      return [
        // helmet(),
        // myCustomMiddleware(_config),
      ]
    },

    /**
     * Called after the application has fully bootstrapped. Use this
     * for post-startup work like logging, health checks, or warming
     * a cache. Runs once per process.
     */
    async onReady(_container: Container): Promise<void> {
      // const log = _container.resolve(Logger)
      // log.info('${pascal} plugin ready')
    },

    /**
     * Called during graceful shutdown. Clean up any long-lived
     * resources this plugin owns (connections, timers, subscriptions).
     */
    async shutdown(): Promise<void> {
      // Example: await this.connection?.close()
    },
  }),
})
`,
  )
  files.push(filePath)

  return files
}
