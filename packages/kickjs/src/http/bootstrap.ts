import { createLogger, Container } from '../core'
import { Application, type ApplicationOptions } from './application'

/** Try to reload env from .env file if config package is available */
function tryReloadEnv(): void {
  try {
    const config = require('@forinda/kickjs-config')
    config.reloadEnv?.()
  } catch {
    // Config package not installed — skip
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
  const g = globalThis as any

  // ── Global error handlers ────────────────────────────────────────────
  if (!g.__kickBootstrapped) {
    process.on('uncaughtException', (err) => {
      log.error(err, 'Uncaught exception')
    })

    process.on('unhandledRejection', (reason) => {
      log.error(reason as any, 'Unhandled rejection')
    })

    // Only register shutdown handlers if Vite is NOT managing the server.
    // When Vite manages the server, the CLI handles shutdown via server.close().
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
  // When Vite re-evaluates the entry file, bootstrap() is called again
  // with FRESH options (new module list, new adapters, etc.).
  // We create a brand new Application with these fresh options instead of
  // reusing the old one — this ensures new modules/controllers are picked up.
  if (g.__app) {
    log.info('HMR: Rebuilding application...')
    tryReloadEnv()
    Container.reset()

    const freshApp = new Application(options)
    g.__app = freshApp
    g.__kickjs_container = freshApp.getContainer()

    // start() detects Vite httpServer and skips listen()
    // It re-runs the full setup pipeline with the fresh module list
    await freshApp.start()
    log.info('HMR: Application rebuilt with fresh modules')
    return freshApp
  }

  // ── First boot ───────────────────────────────────────────────────────
  const app = new Application(options)
  g.__app = app

  // Store the container on globalThis so the HMR plugin can call invalidate()
  g.__kickjs_container = app.getContainer()

  // In tinker mode, register modules and DI but skip starting the HTTP server
  if (process.env.KICK_TINKER) {
    await app.registerOnly()
    return app
  }

  await app.start()

  return app
}
