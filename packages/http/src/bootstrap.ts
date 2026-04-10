import { createLogger } from '@forinda/kickjs-core'
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
 * Bootstrap a KickJS application.
 *
 * Creates the Express app, registers modules and adapters, and starts
 * the HTTP server. In dev mode (`kick dev`), the Vite plugin manages
 * the server and HMR — source changes are picked up instantly without
 * losing database connections or WebSocket state. Graceful shutdown
 * is handled automatically on SIGINT / SIGTERM.
 *
 * @example
 * ```ts
 * // src/index.ts
 * import 'reflect-metadata'
 * import { bootstrap } from '@forinda/kickjs-http'
 * import { modules } from './modules'
 *
 * bootstrap({ modules })
 * ```
 */
export async function bootstrap(options: ApplicationOptions): Promise<void> {
  // Internal: globalThis stores the app across HMR rebuilds so the
  // Express handler can be hot-swapped without restarting the server.
  const g = globalThis as any

  // ── Global error handlers ────────────────────────────────────────────
  if (!g.__kickBootstrapped) {
    process.on('uncaughtException', (err) => {
      log.error(err, 'Uncaught exception')
    })

    process.on('unhandledRejection', (reason) => {
      log.error(reason as any, 'Unhandled rejection')
    })

    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.on(signal, async () => {
        log.info(`Received ${signal}, shutting down...`)
        if (g.__app) await g.__app.shutdown()
        process.exit(0)
      })
    }

    g.__kickBootstrapped = true
  }

  // ── HMR rebuild ──────────────────────────────────────────────────────
  if (g.__app) {
    log.debug('HMR rebuild triggered')
    tryReloadEnv()
    await g.__app.rebuild()
    return
  }

  // ── First boot ───────────────────────────────────────────────────────
  const app = new Application(options)
  g.__app = app

  // In tinker mode, register modules and DI but skip starting the HTTP server
  if (process.env.KICK_TINKER) {
    await app.registerOnly()
    return
  }

  await app.start()

  // ── Vite HMR acceptance ──────────────────────────────────────────────
  const meta = import.meta as any
  if (meta.hot) {
    meta.hot.accept()
  }
}
