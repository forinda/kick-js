import { createLogger } from '@forinda/kickjs-core'
import { Application, type ApplicationOptions } from './application'

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
export function bootstrap(options: ApplicationOptions): void {
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
    g.__app.rebuild()
    return
  }

  // ── First boot ───────────────────────────────────────────────────────
  const app = new Application(options)
  g.__app = app
  app.start()

  // ── Vite HMR acceptance ──────────────────────────────────────────────
  const meta = import.meta as any
  if (meta.hot) {
    meta.hot.accept()
  }
}
