/**
 * `requestLogger()` runs under every runtime, and Fastify / h3 hand connect
 * middleware the RAW node request. Two Express-only reads made it misbehave
 * there:
 *
 *   req.path        → undefined, so `skip` threw
 *                     "Cannot read properties of undefined (reading 'startsWith')"
 *                     on EVERY request once any prefix was configured
 *   req.originalUrl → undefined, so every line logged `GET undefined 200 12ms`
 *
 * The first is a crash, not a degradation: the middleware failed the request
 * rather than declining to log it.
 */
import { describe, expect, it, vi } from 'vitest'
import { requestLogger } from '../src/http/middleware/request-logger'
import { Logger } from '../src/core'

/** Fastify / h3 shape: raw node request — `url`, no `path`, no `originalUrl`. */
function rawReq(url: string, method = 'GET') {
  return { method, url, headers: {} } as never
}

function makeRes() {
  const handlers: Record<string, () => void> = {}
  const res = {
    statusCode: 200,
    on: (event: string, fn: () => void) => {
      handlers[event] = fn
    },
  }
  return { res: res as never, finish: () => handlers.finish?.() }
}

function captureLogs() {
  const messages: string[] = []
  for (const level of ['info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(Logger.prototype, level).mockImplementation(((a: unknown) => {
      messages.push(String(a))
    }) as never)
  }
  return messages
}

describe('requestLogger — engine neutrality', () => {
  it('does not throw when skip is set and the request is raw node', () => {
    captureLogs()
    const { res } = makeRes()
    expect(() =>
      requestLogger({ skip: ['/health'] })(rawReq('/health'), res, () => {}),
    ).not.toThrow()
  })

  it('still skips the configured prefix', () => {
    const messages = captureLogs()
    const { res, finish } = makeRes()
    let nexted = false
    requestLogger({ skip: ['/health'] })(rawReq('/health'), res, () => {
      nexted = true
    })
    finish()
    expect(nexted).toBe(true)
    expect(messages).toHaveLength(0)
  })

  it('ignores the query string when matching skip prefixes', () => {
    const messages = captureLogs()
    const { res, finish } = makeRes()
    requestLogger({ skip: ['/health'] })(rawReq('/health?verbose=1'), res, () => {})
    finish()
    expect(messages).toHaveLength(0)
  })

  it('logs the path rather than undefined', () => {
    const messages = captureLogs()
    const { res, finish } = makeRes()
    requestLogger()(rawReq('/orders/42'), res, () => {})
    finish()
    expect(messages[0]).toContain('/orders/42')
    expect(messages[0]).not.toContain('undefined')
  })

  it('still prefers originalUrl when Express provides it', () => {
    // Express rewrites `url` under a mounted router; `originalUrl` is the
    // full path and stays the better source when present.
    const messages = captureLogs()
    const { res, finish } = makeRes()
    requestLogger()(
      { method: 'GET', url: '/inner', originalUrl: '/api/v1/inner', headers: {} } as never,
      res,
      () => {},
    )
    finish()
    expect(messages[0]).toContain('/api/v1/inner')
  })
})

describe('requestLogger — url fallback', () => {
  it('never logs "undefined" when neither url member exists', () => {
    // `originalUrl` and `url` are both optional; without a floor the line
    // reads `GET undefined` again, just by a different route.
    const messages = captureLogs()
    const { res, finish } = makeRes()
    requestLogger()({ method: 'GET', headers: {} } as never, res, () => {})
    finish()
    expect(messages[0]).not.toContain('undefined')
    expect(messages[0]).toContain('GET /')
  })
})
