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
 * Bootstrap a KickJS application with zero boilerplate.
 *
 * Handles:
 * - Vite HMR (hot-swaps Express handler without restarting the server)
 * - Graceful shutdown on SIGINT / SIGTERM
 * - Global uncaughtException / unhandledRejection handlers
 * - globalThis app storage for HMR rebuild
 *
 * @example
 * ```ts
 * // src/index.ts — that's it, the whole file
 * import 'reflect-metadata'
 * import { bootstrap } from '@forinda/kickjs-http'
 * import { modules } from './modules'
 *
 * bootstrap({ modules })
 * ```
 */
export async function bootstrap(options: ApplicationOptions): Promise<void> {
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
    log.info('HMR: Rebuilding application...')
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
