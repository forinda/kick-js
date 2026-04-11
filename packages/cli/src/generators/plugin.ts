import { join } from 'node:path'
import { writeFileSafe } from '../utils/fs'
import { toPascalCase, toKebabCase, toCamelCase } from '../utils/naming'

interface GeneratePluginOptions {
  name: string
  outDir: string
}

/**
 * Scaffold a `KickPlugin` under `src/plugins/<name>.plugin.ts`.
 *
 * Plugins are the canonical place to wire DI bindings, load extra
 * modules, add middleware, or attach startup hooks without writing a
 * full adapter. The generated template implements every optional
 * `KickPlugin` hook with commented examples so users can uncomment
 * the ones they need and delete the rest.
 */
export async function generatePlugin(options: GeneratePluginOptions): Promise<string[]> {
  const { name, outDir } = options
  const kebab = toKebabCase(name)
  const pascal = toPascalCase(name)
  const camel = toCamelCase(name)
  const factoryName = `${camel}Plugin`
  const files: string[] = []

  const filePath = join(outDir, `${kebab}.plugin.ts`)
  await writeFileSafe(
    filePath,
    `import type { KickPlugin, Container, AppAdapter, AppModuleClass } from '@forinda/kickjs'

/**
 * Options for the ${pascal} plugin.
 *
 * Plugins typically take a small options object in their factory so
 * callers can configure them inline at bootstrap time. Keep the
 * shape narrow — anything derived from the environment should be
 * read via \`getEnv\` inside the plugin itself, not forced onto the
 * caller.
 */
export interface ${pascal}PluginOptions {
  // Add your plugin options here, for example:
  // enabled?: boolean
  // apiKey?: string
}

/**
 * ${pascal} plugin.
 *
 * A \`KickPlugin\` bundles DI bindings, modules, adapters, and
 * middleware into one object that can be added to \`bootstrap({ plugins })\`.
 * Every hook is optional — delete the ones you don't need and keep
 * only the surface your plugin actually uses.
 *
 * Lifecycle order:
 *
 *   1. \`register(container)\`   — runs before user modules load. Use
 *      it to bind services that modules depend on.
 *   2. \`modules()\`               — plugin modules load before user modules.
 *   3. \`adapters()\`              — plugin adapters are added before user adapters.
 *   4. \`middleware()\`            — plugin middleware runs before user middleware.
 *   5. \`onReady(container)\`     — runs after the app has fully bootstrapped.
 *   6. \`shutdown()\`              — runs on graceful shutdown.
 *
 * @example
 * \`\`\`ts
 * import { bootstrap } from '@forinda/kickjs'
 * import { ${factoryName} } from './plugins/${kebab}.plugin'
 *
 * export const app = await bootstrap({
 *   modules,
 *   plugins: [${factoryName}({})],
 * })
 * \`\`\`
 */
export function ${factoryName}(options: ${pascal}PluginOptions = {}): KickPlugin {
  return {
    name: '${kebab}',

    /**
     * Register DI bindings before modules load.
     * Use \`container.registerInstance(TOKEN, value)\` for singletons
     * and \`container.registerFactory(TOKEN, () => ...)\` for lazy
     * constructions.
     */
    register(container: Container): void {
      // Example: bind a configured service to a DI token
      // container.registerInstance(MY_TOKEN, new MyService(options))
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
     * Plugin adapters are added before user adapters.
     */
    adapters(): AppAdapter[] {
      return [
        // new MyAdapter({ ... }),
      ]
    },

    /**
     * Return Express middleware entries to be added to the global
     * pipeline. Plugin middleware runs before user-defined middleware.
     */
    middleware(): any[] {
      return [
        // helmet(),
        // myCustomMiddleware(options),
      ]
    },

    /**
     * Called after the application has fully bootstrapped. Use this
     * for post-startup work like logging, health checks, or warming
     * a cache. Runs once per process.
     */
    async onReady(container: Container): Promise<void> {
      // const logger = container.resolve(Logger)
      // logger.info('${pascal} plugin ready')
    },

    /**
     * Called during graceful shutdown. Clean up any long-lived
     * resources this plugin owns (connections, timers, subscriptions).
     */
    async shutdown(): Promise<void> {
      // await this.connection?.close()
    },
  }
}
`,
  )
  files.push(filePath)

  return files
}
