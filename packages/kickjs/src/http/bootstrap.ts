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
 * Bootstrap a KickJS application.
 *
 * Creates the Express app, registers modules and adapters, and starts
 * the HTTP server. In dev mode (`kick dev`), the Vite plugin manages
 * the server and HMR — source changes are picked up instantly without
 * losing database connections or WebSocket state.
 *
 * @returns The {@link Application} instance.
 *
 * @example
 * ```ts
 * // src/index.ts
 * import 'reflect-metadata'
 * import { bootstrap } from '@forinda/kickjs'
 * import { modules } from './modules'
 *
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

  // Internal: globalThis stores the app instance and Vite's HTTP server
  // reference across HMR rebuilds. When __kickjs_httpServer is set, the
  // Vite plugin owns the port and bootstrap() skips server creation.
  // On subsequent calls (HMR), the Express handler is swapped without
  // restarting the server — preserving DB connections and port bindings.
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
    log.debug('HMR rebuild triggered')
    tryReloadEnv()
    Container.reset()

    const freshApp = new Application(options)
    g.__app = freshApp
    g.__kickjs_container = freshApp.getContainer()

    await freshApp.start()
    log.debug('HMR rebuild complete')
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
