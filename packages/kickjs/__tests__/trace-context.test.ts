import 'reflect-metadata'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import {
  Container,
  Logger,
  requestStore,
  requestScopeMiddleware,
  traceContext,
  parseTraceparent,
  type RequestStore,
} from '../src/index'

// ── parseTraceparent unit tests ────────────────────────────────────────

describe('parseTraceparent', () => {
  it('parses a valid W3C traceparent header', () => {
    const result = parseTraceparent(
      '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    )
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
    expect(
      parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e473-00f067aa0ba902b7-01'),
    ).toBeNull()
  })

  it('handles leading/trailing whitespace', () => {
    const result = parseTraceparent(
      '  00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01  ',
    )
    expect(result).not.toBeNull()
    expect(result!.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
  })

  it('normalizes uppercase hex to lowercase', () => {
    const result = parseTraceparent(
      '00-4BF92F3577B34DA6A3CE929D0E0E4736-00F067AA0BA902B7-01',
    )
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
      const store = requestStore.getStore()
      capturedTraceId = store?.values.get('traceId')
      capturedSpanId = store?.values.get('spanId')
      res.json({ ok: true })
    })

    await request(app)
      .get('/probe')
      .set('traceparent', '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')

    expect(capturedTraceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
    expect(capturedSpanId).toBe('00f067aa0ba902b7')
  })

  it('generates a traceId when no traceparent header is present', async () => {
    const app = express()
    let capturedTraceId: string | undefined

    app.use(requestScopeMiddleware())
    app.use(traceContext())
    app.get('/probe', (_req, res) => {
      const store = requestStore.getStore()
      capturedTraceId = store?.values.get('traceId')
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
      const store = requestStore.getStore()
      capturedTraceId = store?.values.get('traceId')
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
    expect(reqSpanId).toBe('00f067aa0ba902b7')
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
      const store = requestStore.getStore()
      flags = store?.values.get('traceFlags')
      version = store?.values.get('traceVersion')
      res.json({ ok: true })
    })

    await request(app)
      .get('/probe')
      .set('traceparent', '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')

    expect(flags).toBe('01')
    expect(version).toBe('00')
  })
})

// ── Logger context integration ─────────────────────────────────────────

describe('traceId in Logger context', () => {
  beforeEach(() => {
    Container.reset()
    // Wire the logger context provider the same way Application does
    Container._requestStoreProvider = () => requestStore.getStore() ?? null
    Logger._contextProvider = () => {
      const store = requestStore.getStore()
      if (!store) return null
      const ctx: Record<string, any> = { requestId: store.requestId }
      const traceId = store.values.get('traceId')
      if (traceId) ctx.traceId = traceId
      const spanId = store.values.get('spanId')
      if (spanId) ctx.spanId = spanId
      return ctx
    }
  })

  afterEach(() => {
    Container._requestStoreProvider = null
    Logger._contextProvider = null
  })

  it('traceId appears in logger context during a request with traceparent', async () => {
    const app = express()
    let loggerContext: Record<string, any> | null = null

    app.use(requestScopeMiddleware())
    app.use(traceContext())
    app.get('/probe', (_req, res) => {
      // Access the context the same way the Logger does internally
      loggerContext = Logger._contextProvider?.() ?? null
      res.json({ ok: true })
    })

    await request(app)
      .get('/probe')
      .set('traceparent', '00-abcdef1234567890abcdef1234567890-1234567890abcdef-01')

    expect(loggerContext).not.toBeNull()
    expect(loggerContext!.traceId).toBe('abcdef1234567890abcdef1234567890')
    expect(loggerContext!.spanId).toBe('1234567890abcdef')
    expect(loggerContext!.requestId).toBeDefined()
  })

  it('traceId appears in logger context when no traceparent (auto-generated)', async () => {
    const app = express()
    let loggerContext: Record<string, any> | null = null

    app.use(requestScopeMiddleware())
    app.use(traceContext())
    app.get('/probe', (_req, res) => {
      loggerContext = Logger._contextProvider?.() ?? null
      res.json({ ok: true })
    })

    await request(app).get('/probe')

    expect(loggerContext).not.toBeNull()
    expect(loggerContext!.traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(loggerContext!.spanId).toMatch(/^[0-9a-f]{16}$/)
  })
})
