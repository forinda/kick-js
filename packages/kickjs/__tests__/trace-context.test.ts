import 'reflect-metadata'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import {
  getRequestValue,
  Container,
  requestStore,
  requestScopeMiddleware,
  traceContext,
  parseTraceparent,
} from '../src/index'

// ── parseTraceparent unit tests ────────────────────────────────────────

describe('parseTraceparent', () => {
  it('parses a valid W3C traceparent header', () => {
    const result = parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')
    expect(result).toEqual({
      version: '00',
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      parentSpanId: '00f067aa0ba902b7',
      flags: '01',
    })
  })

  it('returns null for an invalid traceparent', () => {
    expect(parseTraceparent('invalid-header')).toBeNull()
    expect(parseTraceparent('')).toBeNull()
    expect(parseTraceparent('00-short-id-01')).toBeNull()
    // Wrong length trace ID (31 chars instead of 32)
    expect(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e473-00f067aa0ba902b7-01')).toBeNull()
  })

  it('handles leading/trailing whitespace', () => {
    const result = parseTraceparent('  00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01  ')
    expect(result).not.toBeNull()
    expect(result!.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
  })

  it('normalizes uppercase hex to lowercase', () => {
    const result = parseTraceparent('00-4BF92F3577B34DA6A3CE929D0E0E4736-00F067AA0BA902B7-01')
    expect(result).not.toBeNull()
    expect(result!.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
    expect(result!.parentSpanId).toBe('00f067aa0ba902b7')
  })
})

// ── traceContext middleware unit tests ──────────────────────────────────

describe('traceContext middleware', () => {
  it('extracts traceId from valid traceparent header', async () => {
    const app = express()
    let capturedTraceId: string | undefined
    let capturedSpanId: string | undefined

    app.use(requestScopeMiddleware())
    app.use(traceContext())
    app.get('/probe', (_req, res) => {
      capturedTraceId = getRequestValue('traceId')
      capturedSpanId = getRequestValue('spanId')
      res.json({ ok: true })
    })

    await request(app)
      .get('/probe')
      .set('traceparent', '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')

    expect(capturedTraceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
    // spanId is always freshly generated per W3C spec (incoming parent-id is stored as parentSpanId)
    expect(capturedSpanId).toMatch(/^[0-9a-f]{16}$/)
    expect(capturedSpanId).not.toBe('00f067aa0ba902b7')
  })

  it('generates a traceId when no traceparent header is present', async () => {
    const app = express()
    let capturedTraceId: string | undefined

    app.use(requestScopeMiddleware())
    app.use(traceContext())
    app.get('/probe', (_req, res) => {
      capturedTraceId = getRequestValue('traceId')
      res.json({ ok: true })
    })

    await request(app).get('/probe')

    expect(capturedTraceId).toBeDefined()
    expect(capturedTraceId).toMatch(/^[0-9a-f]{32}$/)
  })

  it('generates a new traceId when traceparent header is invalid', async () => {
    const app = express()
    let capturedTraceId: string | undefined

    app.use(requestScopeMiddleware())
    app.use(traceContext())
    app.get('/probe', (_req, res) => {
      capturedTraceId = getRequestValue('traceId')
      res.json({ ok: true })
    })

    await request(app).get('/probe').set('traceparent', 'garbage-value')

    expect(capturedTraceId).toBeDefined()
    // Should be a valid 32-hex trace ID, not the garbage value
    expect(capturedTraceId).toMatch(/^[0-9a-f]{32}$/)
  })

  it('attaches traceId and spanId to req object', async () => {
    const app = express()
    let reqTraceId: string | undefined
    let reqSpanId: string | undefined

    app.use(requestScopeMiddleware())
    app.use(traceContext())
    app.get('/probe', (req, res) => {
      reqTraceId = (req as any).traceId
      reqSpanId = (req as any).spanId
      res.json({ ok: true })
    })

    await request(app)
      .get('/probe')
      .set('traceparent', '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')

    expect(reqTraceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
    // spanId is always freshly generated per W3C spec
    expect(reqSpanId).toMatch(/^[0-9a-f]{16}$/)
    expect(reqSpanId).not.toBe('00f067aa0ba902b7')
  })

  it('sets traceresponse header when propagateResponse is true', async () => {
    const app = express()

    app.use(requestScopeMiddleware())
    app.use(traceContext({ propagateResponse: true }))
    app.get('/probe', (_req, res) => {
      res.json({ ok: true })
    })

    const res = await request(app)
      .get('/probe')
      .set('traceparent', '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')

    expect(res.headers['traceresponse']).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
  })

  it('stores traceFlags and traceVersion when traceparent is valid', async () => {
    const app = express()
    let flags: string | undefined
    let version: string | undefined

    app.use(requestScopeMiddleware())
    app.use(traceContext())
    app.get('/probe', (_req, res) => {
      flags = getRequestValue('traceFlags')
      version = getRequestValue('traceVersion')
      res.json({ ok: true })
    })

    await request(app)
      .get('/probe')
      .set('traceparent', '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')

    expect(flags).toBe('01')
    expect(version).toBe('00')
  })
})

// ── Trace values in the request store ──────────────────────────────────

/**
 * The per-request trace fields, read straight from the request store.
 *
 * This used to go through a `Logger._contextProvider` hook that the test
 * assigned to itself and then asserted on — a static that exists nowhere in
 * `src`, so the round trip exercised no framework code. The real subject is
 * `traceContext()` populating the store, which is what this reads.
 */
function readTraceContext(): Record<string, unknown> | null {
  const store = requestStore.getStore()
  if (!store) return null
  const ctx: Record<string, unknown> = { requestId: store.requestId }
  const traceId = getRequestValue('traceId')
  if (traceId) ctx.traceId = traceId
  const spanId = getRequestValue('spanId')
  if (spanId) ctx.spanId = spanId
  return ctx
}

// ── Trace context integration ──────────────────────────────────────────

describe('traceId in the per-request trace context', () => {
  beforeEach(() => {
    Container.reset()
    Container._requestStoreProvider = () => requestStore.getStore() ?? null
  })

  afterEach(() => {
    Container._requestStoreProvider = null
  })

  it('traceId appears in logger context during a request with traceparent', async () => {
    const app = express()
    let loggerContext: Record<string, any> | null = null

    app.use(requestScopeMiddleware())
    app.use(traceContext())
    app.get('/probe', (_req, res) => {
      loggerContext = readTraceContext()
      res.json({ ok: true })
    })

    await request(app)
      .get('/probe')
      .set('traceparent', '00-abcdef1234567890abcdef1234567890-1234567890abcdef-01')

    expect(loggerContext).not.toBeNull()
    expect(loggerContext!.traceId).toBe('abcdef1234567890abcdef1234567890')
    // spanId is always freshly generated per W3C spec
    expect(loggerContext!.spanId).toMatch(/^[0-9a-f]{16}$/)
    expect(loggerContext!.requestId).toBeDefined()
  })

  it('traceId appears in logger context when no traceparent (auto-generated)', async () => {
    const app = express()
    let loggerContext: Record<string, any> | null = null

    app.use(requestScopeMiddleware())
    app.use(traceContext())
    app.get('/probe', (_req, res) => {
      loggerContext = readTraceContext()
      res.json({ ok: true })
    })

    await request(app).get('/probe')

    expect(loggerContext).not.toBeNull()
    expect(loggerContext!.traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(loggerContext!.spanId).toMatch(/^[0-9a-f]{16}$/)
  })
})
