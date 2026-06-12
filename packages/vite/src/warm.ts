/**
 * Eager app re-warm after an invalidation.
 *
 * The dev server evaluates `virtual:kickjs/app` lazily — after a save
 * invalidates it, re-evaluation waits for the NEXT HTTP request. A
 * broken file (syntax error, failed import, boot throw) was therefore
 * silent until something hit the server, even though startup surfaced
 * the same class of error eagerly. Re-warming right after invalidation
 * pushes transform/bootstrap errors into the dev console the moment
 * the save lands.
 *
 * Errors are logged (with fixed stacktraces) but never thrown — the
 * dev loop must survive a mid-edit broken state; the next successful
 * save heals it.
 */
import type { ViteDevServer } from 'vite'

import { VIRTUAL_APP } from './virtual-modules'

export function rewarmApp(server: ViteDevServer, reason: string): void {
  server.ssrLoadModule(VIRTUAL_APP).catch((err: unknown) => {
    if (err instanceof Error) server.ssrFixStacktrace(err)
    server.config.logger.error(
      `[kickjs] app failed to reload after ${reason}: ${
        err instanceof Error ? err.message : String(err)
      }`,
      { timestamp: true },
    )
  })
}
