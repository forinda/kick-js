/**
 * The default error handler runs under EVERY runtime, so it must not assume
 * Express.
 *
 * Fastify and h3 hand it `request.raw` — a plain node `IncomingMessage`. It
 * read `req.originalUrl`, which only Express adds, so the one log line meant
 * to identify the failing request read `GET undefined — <error>` on those
 * runtimes. The path silently vanished exactly when it was needed.
 */
import { describe, expect, it, vi } from 'vitest'
import { errorHandler, notFoundHandler } from '../src/http/middleware/error-handler'
import { Logger } from '../src/core'

function makeRes() {
  const calls: Array<{ status?: number; body?: unknown }> = []
  const res = {
    headersSent: false,
    setHeader: () => res,
    status: (code: number) => {
      calls.push({ status: code })
      return res
    },
    json: (body: unknown) => {
      calls[calls.length - 1]!.body = body
      return res
    },
  }
  return { res, calls }
}

function captureErrorLog() {
  const messages: string[] = []
  vi.spyOn(Logger.prototype, 'error').mockImplementation(((_e: unknown, m?: string) => {
    messages.push(String(m))
  }) as never)
  return messages
}

describe('errorHandler — engine neutrality', () => {
  it('logs the path from a raw node request (fastify / h3 shape)', () => {
    const messages = captureErrorLog()
    const { res } = makeRes()
    // Exactly what Fastify passes: `request.raw`, with `url` and no `originalUrl`.
    const req = { method: 'GET', url: '/boom', headers: {} }

    errorHandler()(new Error('kaboom'), req as never, res as never, () => {})

    expect(messages[0]).toContain('/boom')
    expect(messages[0]).not.toContain('undefined')
  })

  it('still prefers originalUrl when Express provides it', () => {
    // Express rewrites `url` when mounting routers; `originalUrl` is the
    // full path, so it stays the better source when present.
    const messages = captureErrorLog()
    const { res } = makeRes()
    const req = { method: 'GET', url: '/inner', originalUrl: '/api/v1/inner', headers: {} }

    errorHandler()(new Error('kaboom'), req as never, res as never, () => {})

    expect(messages[0]).toContain('/api/v1/inner')
  })

  it('notFoundHandler answers through the runtime response surface', () => {
    const { res, calls } = makeRes()
    notFoundHandler()({ method: 'GET', url: '/nope', headers: {} } as never, res as never, () => {})
    expect(calls[0]).toEqual({ status: 404, body: { message: 'Not Found' } })
  })
})
