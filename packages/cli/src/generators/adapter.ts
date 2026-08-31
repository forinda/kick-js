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
 * template uses the new factory shape so adopters get a working adapter with
 * EVERY hook on `AppAdapter`, a typed config object with defaults, and the
 * factory's call / `.scoped()` / `.async()` surfaces — without writing a
 * single class.
 *
 * "Every hook" is the point, and `adapter-generator.test.ts` pins it: the
 * scaffold is how adopters discover what an adapter can do, so a hook missing
 * here is a feature that effectively does not exist. `onHealthCheck` was
 * absent for several releases, and adopters hand-rolled their own
 * `/health/ready` instead of contributing to the built-in one.
 */
export async function generateAdapter(options: GenerateAdapterOptions): Promise<string[]> {
  const { name, outDir } = options
  const kebab = toKebabCase(name)
  const pascal = toPascalCase(name)
  const files: string[] = []

  const filePath = join(outDir, `${kebab}.adapter.ts`)
  await writeFileSafe(
    filePath,
    `import {
  defineAdapter,
  type AdapterContext,
  type AdapterMiddleware,
  type ContributorRegistrations,
  type Constructor,
} from '@forinda/kickjs'

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
 * Context Contributors, or external service connections.
 *
 * Every lifecycle hook below is OPTIONAL. The scaffold emits all of
 * them so adopters can browse what's available and delete what they
 * don't need — \`build()\` returning \`{}\` is also valid for an adapter
 * that only contributes config defaults.
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
    // Default config values go here. The adopter's overrides shallow-merge
    // on top of these before \`build()\` runs.
  },
  build: (_config, { name: _name }) => {
    // Closures inside \`build()\` are how each adapter instance owns its
    // own state (database client, Map, timer handle, …). The same
    // \`_config\` is visible to every hook below.

    return {
      /**
       * Connect-style middleware entries the Application mounts at named
       * phases. Works on every runtime — Express, Fastify and h3 all accept
       * the connect signature through the runtime seam.
       *
       * \`phase\` controls where each handler sits in the pipeline:
       *   'beforeGlobal' | 'afterGlobal' | 'beforeRoutes' | 'afterRoutes'.
       *
       * \`path\` (optional) scopes the entry to a path prefix.
       *
       * Delete this hook entirely if you don't add middleware.
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
          // Example: scope a rate limiter to one path prefix
          // {
          //   phase: 'beforeRoutes',
          //   path: '/api/v1/auth',
          //   handler: rateLimit({ max: 10 }),
          // },
        ]
      },

      /**
       * Runs BEFORE global middleware. Mount routes that should bypass the
       * middleware stack — health checks, docs UI, static assets, OAuth
       * callbacks. Anything you want reachable even if a global middleware
       * later in the chain rejects requests.
       *
       * Delete this hook if you have no early routes.
       */
      beforeMount(_ctx: AdapterContext): void {
        // Example:
        // _ctx.app.get('/${kebab}/status', (_req, res) => res.json({ status: 'ok' }))
      },

      /**
       * Fires once per controller class as the router mounts. Use this to
       * collect route metadata for OpenAPI specs, dependency graphs, route
       * inventories, devtools dashboards.
       *
       * Delete this hook unless your adapter introspects the route registry.
       */
      onRouteMount(_controllerClass: Constructor, _mountPath: string): void {
        // Example (Swagger-style): collect routes for the spec.
        // openApiSpec.addController(_controllerClass, _mountPath)
      },

      /**
       * Runs AFTER modules + routes are wired, BEFORE the server starts.
       * Right place for late-stage DI registrations or final config validation.
       *
       * Delete this hook if there's nothing to wire post-modules.
       */
      beforeStart(_ctx: AdapterContext): void {
        // Example: _ctx.container.registerInstance(MY_TOKEN, new MyService(_config))
      },

      /**
       * Runs AFTER the HTTP server is listening. The raw \`http.Server\` is
       * available on \`ctx.server\` — attach upgrade handlers (Socket.IO,
       * gRPC, GraphQL subscriptions), warm caches, log a banner.
       *
       * Delete this hook if you don't need the running server reference.
       */
      afterStart(_ctx: AdapterContext): void {
        // Example: const io = new Server(_ctx.server)
      },

      /**
       * Returns Context Contributors to merge into every route's pipeline
       * at the \`'adapter'\` precedence level. Per-route handlers can
       * override the value at the method / class / module level.
       *
       * Delete this hook unless your adapter ships typed per-request values
       * (auth user, tenant, locale, feature flags, geo, etc).
       */
      contributors(): ContributorRegistrations {
        return [
          // Example:
          // import { defineHttpContextDecorator } from '@forinda/kickjs'
          // declare module '@forinda/kickjs' { interface ContextMeta { ${kebab}: { id: string } } }
          // const Load${pascal} = defineHttpContextDecorator({
          //   key: '${kebab}',
          //   resolve: (ctx) => ({ id: ctx.req.headers['x-${kebab}-id'] as string }),
          // })
          // return [Load${pascal}.registration]
        ]
      },

      /**
       * Runs on graceful shutdown AND on every HMR reload. Clean up
       * long-lived resources the adapter OWNS: close connections, flush
       * buffers, cancel timers.
       *
       * Close only what you own — \`ctx.server\` is shared (in dev it is
       * Vite's listener), and closing it kills the dev server with no
       * rebind. socket.io's \`io.close()\` does this; use
       * \`io.engine.close()\` to detach instead.
       *
       * The framework runs every adapter's \`shutdown\` concurrently via
       * \`Promise.allSettled\`, each time-boxed — one failure or hang won't
       * block sibling adapters.
       *
       * Delete this hook if your adapter holds no resources.
       */
      async shutdown(): Promise<void> {
        // Example: await this.pool.end()
        // Example: clearInterval(this.heartbeatTimer)
      },

      /**
       * Reports this adapter's backing service to \`GET /health/ready\`.
       *
       * The Application aggregates every adapter's check through
       * \`Promise.allSettled\` and serves the combined result, so contributing
       * one here is what makes your dependency visible to the built-in
       * readiness endpoint — no route of your own required.
       *
       * Keep it cheap and time-boxed: readiness is polled by orchestrators.
       *
       * Delete this hook if your adapter has nothing to report.
       */
      async onHealthCheck(): Promise<{ name: string; status: 'up' | 'down' }> {
        // Example:
        // try {
        //   await _config.client.ping()
        //   return { name: '${kebab}', status: 'up' }
        // } catch {
        //   return { name: '${kebab}', status: 'down' }
        // }
        return { name: '${kebab}', status: 'up' }
      },

      /**
       * Snapshot for the DevTools topology view (\`/_debug\`).
       *
       * Must be CHEAP — the topology endpoint polls on a short interval, so
       * \`state\` and \`metrics\` should be counters and flags already in memory,
       * never a database round trip. Async is allowed for that reason, not as
       * an invitation to do work.
       *
       * Delete this hook if the adapter has nothing worth showing.
       */
      // introspect(): IntrospectionSnapshot {
      //   return {
      //     protocolVersion: 1,
      //     state: { connected: true },
      //     metrics: { handled: 0 },
      //     tokens: [],
      //   }
      // },

      /**
       * DevTools panels this adapter contributes.
       *
       * Import \`defineDevtoolsTab\` from \`@forinda/kickjs-devtools-kit\`;
       * \`@forinda/kickjs\` deliberately does not depend on the kit at runtime.
       *
       * Delete this hook unless the adapter ships a panel.
       */
      // devtoolsTabs() {
      //   return [
      //     defineDevtoolsTab({
      //       id: '${kebab}',
      //       title: '${pascal}',
      //       kind: 'html',
      //       render: () => '<p>${pascal} adapter</p>',
      //     }),
      //   ]
      // },
    }
  },
})
`,
  )
  files.push(filePath)

  return files
}
