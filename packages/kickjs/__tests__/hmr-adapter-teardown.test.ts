/**
 * Every HMR rebuild used to leak an adapter set.
 *
 * `bootstrap()` keeps the live app on `globalThis.__app`, and the reload path
 * even tested for it — then replaced it without calling `shutdown()`:
 *
 *   if (g.__app) {
 *     const freshApp = new Application(options)
 *     g.__app = freshApp        // old one dropped, still running
 *   }
 *
 * `shutdown()` ran only from the SIGINT / SIGTERM handler, so in a dev session
 * every save added another set of live adapters. Observed as one process
 * holding several Kafka consumer-group members — on a single-partition topic
 * only one can hold the assignment, and it was a leaked consumer wired to
 * nothing, so jobs silently stopped being processed. A second socket.io server
 * on the same HTTP server crashed `handleUpgrade()` by the same mechanism.
 *
 * The fix cannot simply call `shutdown()`: in dev the HTTP server is SHARED
 * across rebuilds, so closing it kills the dev server on the first save. Hence
 * `closeServer: false` — tear down adapters, keep the socket.
 */
import 'reflect-metadata'
import http from 'node:http'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Container } from '../src/index'
import { Application } from '../src/http/application'
import type { AppAdapter, KickPlugin } from '../src/core'

function countingAdapter(log: string[], name = 'Counting'): AppAdapter {
  return {
    name,
    beforeMount: () => {
      log.push(`${name}:start`)
    },
    shutdown: async () => {
      log.push(`${name}:shutdown`)
    },
  }
}

function countingPlugin(log: string[], name = 'Metrics'): KickPlugin {
  return {
    name,
    shutdown: async () => {
      log.push(`${name}:shutdown`)
    },
  }
}

let servers: http.Server[] = []
beforeEach(() => Container.reset())
afterEach(() => {
  for (const s of servers.splice(0)) s.close()
})

describe('shutdown({ closeServer: false }) — the HMR teardown path', () => {
  it('runs adapter shutdown', async () => {
    const log: string[] = []
    const app = new Application({ modules: [], adapters: [countingAdapter(log)], port: 0 })
    await app.setup()

    await app.shutdown({ closeServer: false })

    expect(log).toContain('Counting:shutdown')
  })

  it('leaves the shared HTTP server listening', async () => {
    // The load-bearing half. A full shutdown closes the server, which in dev
    // is reused across rebuilds — doing that on reload kills HMR outright.
    const server = http.createServer()
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, resolve))
    const g = globalThis as unknown as { __kickjs_httpServer?: http.Server }
    const prev = g.__kickjs_httpServer
    g.__kickjs_httpServer = server
    try {
      const app = new Application({ modules: [], adapters: [], port: 0 })
      // `start()`, not `setup()` — only `start()` adopts the shared
      // `__kickjs_httpServer`. Under `setup()` `app.httpServer` stays undefined,
      // so `closeServer` is never reached and this passed even when the flag
      // was ignored outright.
      await app.start()

      await app.shutdown({ closeServer: false })

      expect(server.listening).toBe(true)
    } finally {
      g.__kickjs_httpServer = prev
    }
  })

  it('still closes the server on a real shutdown', async () => {
    // The SIGINT path must be unchanged.
    const app = new Application({ modules: [], adapters: [], port: 0 })
    await app.start()
    const server = app.getHttpServer()
    expect(server).not.toBeNull()
    servers.push(server!)

    await app.shutdown()

    expect(server!.listening).toBe(false)
  })

  it('tears down every adapter, not just the first', async () => {
    const log: string[] = []
    const app = new Application({
      modules: [],
      adapters: [countingAdapter(log, 'Ws'), countingAdapter(log, 'Kafka')],
      port: 0,
    })
    await app.setup()

    await app.shutdown({ closeServer: false })

    expect(log).toContain('Ws:shutdown')
    expect(log).toContain('Kafka:shutdown')
  })

  it('tears plugins down too, not only adapters', async () => {
    // Step 3 of shutdown runs plugins and adapters together, so a plugin
    // holding a timer or a connection leaked exactly the same way.
    const log: string[] = []
    const app = new Application({
      modules: [],
      adapters: [countingAdapter(log, 'Kafka')],
      plugins: [countingPlugin(log, 'Metrics')],
      port: 0,
    })
    await app.setup()

    await app.shutdown({ closeServer: false })

    expect(log).toContain('Metrics:shutdown')
    expect(log).toContain('Kafka:shutdown')
  })

  it('does not let one failing plugin block adapter teardown', async () => {
    const log: string[] = []
    const exploding: KickPlugin = {
      name: 'Exploding',
      shutdown: async () => {
        throw new Error('plugin teardown failed')
      },
    }
    const app = new Application({
      modules: [],
      adapters: [countingAdapter(log, 'Kafka')],
      plugins: [exploding],
      port: 0,
    })
    await app.setup()

    await expect(app.shutdown({ closeServer: false })).resolves.toBeUndefined()
    expect(log).toContain('Kafka:shutdown')
  })

  it('does not let one failing adapter block the others', async () => {
    // A reload must not be wedged by a single bad teardown.
    const log: string[] = []
    const exploding: AppAdapter = {
      name: 'Exploding',
      shutdown: async () => {
        throw new Error('teardown failed')
      },
    }
    const app = new Application({
      modules: [],
      adapters: [exploding, countingAdapter(log, 'Kafka')],
      port: 0,
    })
    await app.setup()

    await expect(app.shutdown({ closeServer: false })).resolves.toBeUndefined()
    expect(log).toContain('Kafka:shutdown')
  })
})

/**
 * The leak itself, through the real reload path.
 *
 * `bootstrap()` treats a populated `globalThis.__app` as "this is an HMR
 * rebuild". Calling it twice in one process is exactly what a dev-server save
 * does, so this counts how many adapter sets are left running.
 */
describe('bootstrap() HMR rebuild', () => {
  const g = globalThis as unknown as {
    __app?: unknown
    __kickBootstrapped?: boolean
    __kickjs_container?: unknown
    __kickjs_httpServer?: http.Server
    __kickjs_app_shutdown?: unknown
  }
  // Every global `bootstrap()`/`start()` touch, not just the two this suite
  // sets itself — `__kickjs_container` and `__kickjs_app_shutdown` are written
  // as a side effect, and leaving either behind hands the next test file a
  // stale container or a shutdown hook bound to a dead app.
  const GLOBAL_KEYS = [
    '__app',
    '__kickBootstrapped',
    '__kickjs_container',
    '__kickjs_httpServer',
    '__kickjs_app_shutdown',
  ] as const
  let saved: Partial<Record<(typeof GLOBAL_KEYS)[number], unknown>>

  beforeEach(() => {
    saved = {}
    for (const k of GLOBAL_KEYS) saved[k] = g[k]
    delete g.__app
  })
  afterEach(() => {
    for (const k of GLOBAL_KEYS) {
      // Restore absence as absence — assigning `undefined` leaves the key
      // present, and `if (g.__kickjs_httpServer)` reads differently from
      // a key that was never set.
      if (saved[k] === undefined) delete (g as Record<string, unknown>)[k]
      else (g as Record<string, unknown>)[k] = saved[k]
    }
  })

  it('shuts the previous app down before replacing it', async () => {
    const { bootstrap } = await import('../src/http/bootstrap')
    const log: string[] = []
    // A shared server, as the Vite plugin provides in dev.
    const server = http.createServer()
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, resolve))
    g.__kickjs_httpServer = server

    // No try/finally — the suite-level afterEach restores
    // `__kickjs_httpServer` to whatever it was, which `delete` did not do.
    const opts = () => ({ modules: [], adapters: [countingAdapter(log, 'Kafka')], port: 0 })
    await bootstrap(opts())
    // The "save a file" moment.
    await bootstrap(opts())

    // Previously: two live adapter sets, zero shutdowns — one leaked
    // consumer per reload.
    expect(log.filter((l) => l === 'Kafka:shutdown')).toHaveLength(1)
    // And the shared dev server must survive the rebuild.
    expect(server.listening).toBe(true)
  })
})
