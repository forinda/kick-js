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
  type AppModuleEntry,
  type Container,
  type ContributorRegistrations,
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
 * Call order (each hook is optional — delete the ones you don't need and
 * keep only the surface your plugin actually uses). This is the order the
 * hooks are INVOKED in, which is not the order they read in below:
 *
 *   1. \`adapters()\`           — read first, while the app is still being
 *      constructed; the returned adapters mount before user adapters.
 *   2. \`register(container)\`  — runs before user modules load. Use it to
 *      bind services that modules depend on.
 *   3. \`middleware()\`         — mounts BEFORE \`modules()\` is read, so a
 *      handler here cannot resolve anything a plugin module registers.
 *   4. \`modules()\` / \`setup(registry)\` — plugin modules load before user
 *      modules.
 *   5. \`contributors()\`       — Context Contributors merged into every route.
 *   6. \`onReady(container)\`   — runs after the app has fully bootstrapped.
 *   7. \`shutdown()\`           — on shutdown AND every HMR reload.
 *
 * \`.async()\` resolves its config inside \`onReady\`, which is past every
 * contribution point above: only \`register()\`, \`onReady()\` and
 * \`shutdown()\` still run. Use the bare or \`.scoped()\` form when the plugin
 * ships modules, adapters, middleware, or contributors.
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
     * Return modules this plugin contributes to the app. These load
     * before user modules, so plugin controllers and services are
     * available for user code to \`@Autowired\`.
     *
     * Accepts both \`defineModule\`-style instances (call the factory:
     * \`ExampleModule()\`) and legacy \`class … implements AppModule\`
     * constructors.
     */
    modules(): AppModuleEntry[] {
      return [
        // ExampleModule(),
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
     * Return connect-style handlers — \`(req, res, next)\` — for the global
     * pipeline. Every runtime accepts them: each one is mounted through the
     * engine's \`useConnect\` seam, so this is NOT Express-only. Plugin
     * middleware runs before user-defined middleware, and takes no
     * \`phase\` / \`path\` — use an adapter's \`middleware()\` for those.
     */
    middleware(): unknown[] {
      return [
        // helmet(),
        // myCustomMiddleware(_config),
      ]
    },

    /**
     * Return Context Contributors to merge into every route's pipeline.
     * Plugins contribute at the same \`'adapter'\` precedence level as
     * adapters — overrideable per-route at the method / class / module
     * level. See https://kickjs.app/guide/context-decorators
     *
     * Delete this hook if your plugin doesn't ship typed per-request values.
     */
    contributors(): ContributorRegistrations {
      return [
        // Example:
        // import { defineHttpContextDecorator } from '@forinda/kickjs'
        // declare module '@forinda/kickjs' { interface ContextMeta { ${kebab}: { foo: string } } }
        // const Load${pascal} = defineHttpContextDecorator({
        //   key: '${kebab}',
        //   resolve: (ctx) => ({ foo: ctx.req.headers['x-${kebab}'] as string }),
        // })
        // return [Load${pascal}.registration]
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
     * Called during graceful shutdown AND on every HMR reload. Clean up
     * long-lived resources this plugin OWNS (connections, timers,
     * subscriptions). Never close the shared HTTP server — in dev that is
     * Vite's listener and it will not rebind.
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
