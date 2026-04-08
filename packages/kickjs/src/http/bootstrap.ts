import cluster from 'node:cluster'
import { createLogger, Container } from '../core'
import { reloadEnv } from '../config/env'
import { Application, type ApplicationOptions } from './application'
import { setupClusterPrimary, type ClusterOptions } from './cluster'

/** Reload env from .env file (HMR rebuild) — config now lives in-tree. */
function tryReloadEnv(): void {
  try {
    reloadEnv()
  } catch {
    // Best-effort: never crash bootstrap because env reload failed.
  }
}

const log = createLogger('Process')

/**
 * Bootstrap a KickJS application with zero boilerplate.
 *
 * ## Dev Mode (with @forinda/kickjs-vite)
 *
 * When the Vite plugin is active (`globalThis.__kickjs_httpServer` is set),
 * `bootstrap()` sets up the Express app and adapters but does NOT start
 * the HTTP server — Vite owns the port. The returned `app` object has a
 * `.handle(req, res, next)` method that the Vite dev-server plugin calls
 * on each request via `ssrLoadModule()`.
 *
 * ## Production Mode
 *
 * Without the Vite plugin, `bootstrap()` creates its own `http.Server`,
 * binds to the port, and starts listening — same behavior as before.
 *
 * ## HMR
 *
 * On subsequent calls (module re-evaluation), `bootstrap()` rebuilds the
 * Express app and swaps the request handler without restarting the server.
 *
 * @returns The Application instance. In Vite dev mode, the Express handler
 *   is accessible at `app.handle` for the dev-server plugin to use.
 *
 * @example
 * ```ts
 * // src/index.ts
 * import 'reflect-metadata'
 * import { bootstrap } from '@forinda/kickjs'
 * import { modules } from './modules'
 *
 * // Export for Vite plugin (dev) — also works standalone (prod)
 * export const app = await bootstrap({ modules })
 * ```
 */
export async function bootstrap(options: ApplicationOptions): Promise<Application> {
  // ── Cluster mode ─────────────────────────────────────────────────────
  // In cluster mode the primary process forks workers and never runs the
  // Express application itself.  Only workers proceed past this block.
  if (options.cluster && cluster.isPrimary) {
    const clusterOpts: ClusterOptions = typeof options.cluster === 'object' ? options.cluster : {}
    setupClusterPrimary(clusterOpts)

    // Return a placeholder — the primary never serves HTTP traffic.
    // The Application is created only so callers get a valid reference.
    return new Application(options)
  }

  const g = globalThis as any

  // ── Global error handlers ────────────────────────────────────────────
  if (!g.__kickBootstrapped) {
    process.on('uncaughtException', (err) => {
      log.error(err, 'Uncaught exception')
    })

    process.on('unhandledRejection', (reason) => {
      log.error(reason as any, 'Unhandled rejection')
    })

    if (!g.__kickjs_httpServer) {
      for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        process.on(signal, async () => {
          log.info(`Received ${signal}, shutting down...`)
          if (g.__app) await g.__app.shutdown()
          process.exit(0)
        })
      }
    }

    g.__kickBootstrapped = true
  }

  // ── HMR rebuild ──────────────────────────────────────────────────────
  if (g.__app) {
    log.info('HMR: Rebuilding application...')
    tryReloadEnv()
    Container.reset()

    const freshApp = new Application(options)
    g.__app = freshApp
    g.__kickjs_container = freshApp.getContainer()

    await freshApp.start()
    log.info('HMR: Application rebuilt with fresh modules')
    return freshApp
  }

  // ── First boot ───────────────────────────────────────────────────────
  const app = new Application(options)
  g.__app = app
  g.__kickjs_container = app.getContainer()

  if (process.env.KICK_TINKER) {
    await app.registerOnly()
    return app
  }

  await app.start()

  return app
}
