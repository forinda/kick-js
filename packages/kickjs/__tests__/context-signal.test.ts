import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import { RequestContext } from '../src/http/context'
import { requestStore } from '../src/http/request-store'

/**
 * M5 follow-up — RequestContext.signal exposes an AbortSignal that
 * fires on request/response close. Threads naturally into
 * `db.query.X.findUnique({ signal: ctx.signal })` so kickjs-db's
 * M5.A.2 cancellation work cancels DB queries when the HTTP client
 * disconnects.
 *
 * Mock req/res as `EventEmitter`s — RequestContext only relies on
 * `req.once('close', ...)` and `res.once('close', ...)` to wire the
 * abort handler, so the real Express plumbing isn't needed for unit
 * coverage. Integration with router-builder runs in the example app
 * (task-kickdb-api).
 */

interface CtxOverrides {
  body?: unknown
  params?: Record<string, unknown>
  query?: Record<string, unknown>
  headers?: Record<string, unknown>
}

function withCtx<T>(
  overrides: CtxOverrides,
  fn: (ctx: RequestContext, req: EventEmitter, res: EventEmitter) => T,
): T {
  const req: EventEmitter & Record<string, unknown> = Object.assign(new EventEmitter(), {
    body: overrides.body ?? {},
    params: overrides.params ?? {},
    query: overrides.query ?? {},
    headers: overrides.headers ?? {},
  })
  const res: EventEmitter & Record<string, unknown> = new EventEmitter()
  const next = () => {}

  const store = { requestId: 'r-test', instances: new Map(), values: new Map() }
  return requestStore.run(store, () =>
    fn(new RequestContext(req as never, res as never, next), req, res),
  )
}

describe('RequestContext.signal', () => {
  it('returns an unaborted AbortSignal before any close event fires', () => {
    withCtx({}, (ctx) => {
      expect(ctx.signal).toBeInstanceOf(AbortSignal)
      expect(ctx.signal.aborted).toBe(false)
    })
  })

  it('aborts the signal when the request emits "close"', () => {
    withCtx({}, (ctx, req) => {
      const signal = ctx.signal
      expect(signal.aborted).toBe(false)
      req.emit('close')
      expect(signal.aborted).toBe(true)
      expect(signal.reason).toBe('request closed')
    })
  })

  it('aborts the signal when the response emits "close"', () => {
    withCtx({}, (ctx, _req, res) => {
      const signal = ctx.signal
      expect(signal.aborted).toBe(false)
      res.emit('close')
      expect(signal.aborted).toBe(true)
      expect(signal.reason).toBe('request closed')
    })
  })

  it('returns the same AbortSignal on repeated access (stable identity)', () => {
    withCtx({}, (ctx) => {
      expect(ctx.signal).toBe(ctx.signal)
    })
  })

  it('shares one AbortController across multiple RequestContext wrappers for the same req', () => {
    // Router-builder constructs separate RequestContext instances
    // for middleware, the contributor pipeline, and the main handler.
    // All must observe the same abort signal — the controller is
    // cached on `req` via a shared Symbol key.
    const req: EventEmitter & Record<string, unknown> = Object.assign(new EventEmitter(), {
      body: {},
      params: {},
      query: {},
      headers: {},
    })
    const res: EventEmitter & Record<string, unknown> = new EventEmitter()
    const next = () => {}

    const store = { requestId: 'r-test', instances: new Map(), values: new Map() }
    requestStore.run(store, () => {
      const ctxA = new RequestContext(req as never, res as never, next)
      const ctxB = new RequestContext(req as never, res as never, next)

      expect(ctxA.signal).toBe(ctxB.signal)

      req.emit('close')
      expect(ctxA.signal.aborted).toBe(true)
      expect(ctxB.signal.aborted).toBe(true)
    })
  })

  it('a second close event is a no-op (AbortController.abort is idempotent)', () => {
    withCtx({}, (ctx, req, res) => {
      const signal = ctx.signal
      req.emit('close')
      const reason1 = signal.reason
      res.emit('close')
      // Reason from the first abort sticks; second abort doesn't
      // overwrite or throw.
      expect(signal.aborted).toBe(true)
      expect(signal.reason).toBe(reason1)
    })
  })
})
