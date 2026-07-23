import 'reflect-metadata'
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { Logger, describeError, type LoggerProvider } from '../src/index'
import { errorHandler } from '../src/http/middleware/error-handler'

// An unexpected 500 used to be undiagnosable from both sides at once:
//
//   response: {"message":"Internal Server Error"}          ← nothing
//   log line: ERROR [ErrorHandler] GET /x — <message>      ← no stack
//
// because `Logger.error(err, msg)` discarded the error object outright
// (`provider.error(msg)` — the error appeared nowhere in the call), and
// the 500 body carried no detail and no correlation id even in dev.

/** Capture what actually reaches the provider. */
function captureProvider() {
  const calls: Array<{ msg: string; args: any[] }> = []
  const provider: LoggerProvider = {
    info: () => {},
    warn: () => {},
    error: (msg, ...args) => calls.push({ msg, args }),
    debug: () => {},
    child: () => provider,
  }
  Logger.setProvider(provider)
  return calls
}

/** Minimal express-ish req/res doubles. */
function mockReq(over: Record<string, unknown> = {}) {
  return { method: 'GET', originalUrl: '/projects/42', headers: {}, ...over } as any
}

function mockRes() {
  const res: any = {
    headersSent: false,
    statusCode: 0,
    body: undefined,
    headers: {} as Record<string, unknown>,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: unknown) {
      res.body = payload
      return res
    },
    setHeader(k: string, v: unknown) {
      res.headers[k] = v
    },
  }
  return res
}

const ORIGINAL_ENV = process.env.NODE_ENV

afterEach(() => {
  Logger.resetProvider()
  process.env.NODE_ENV = ORIGINAL_ENV
})

describe('Logger.error — error-first form', () => {
  let calls: ReturnType<typeof captureProvider>
  beforeEach(() => {
    calls = captureProvider()
  })

  it('forwards the error object so the stack survives', () => {
    const err = new Error('relation "users" does not exist')
    Logger.for('T').error(err, 'GET /users failed')

    expect(calls).toHaveLength(1)
    expect(calls[0].msg).toBe('GET /users failed')
    // The regression: the error used to appear nowhere in the call.
    expect(calls[0].args).toContain(err)
    expect((calls[0].args[0] as Error).stack).toBeDefined()
  })

  it('uses the error summary as the line when no message is given', () => {
    const err = new Error('boom')
    Logger.for('T').error(err)
    expect(calls[0].msg).toContain('boom')
    expect(calls[0].args).toContain(err)
  })

  it('no longer drops trailing args on the message-first form', () => {
    Logger.for('T').error('save failed', { id: 7 })
    expect(calls[0]).toEqual({ msg: 'save failed', args: [{ id: 7 }] })
  })
})

describe('describeError', () => {
  it('includes the error name', () => {
    expect(describeError(new TypeError('bad'))).toBe('TypeError: bad')
  })

  it('walks the cause chain — where ORM drivers hide the real reason', () => {
    const root = new Error('relation "users" does not exist')
    const wrapped = new Error('Query failed', { cause: root })
    const outer = new Error('findMany failed', { cause: wrapped })
    const out = describeError(outer)
    expect(out).toContain('findMany failed')
    expect(out).toContain('Query failed')
    expect(out).toContain('relation "users" does not exist')
  })

  it('survives a circular cause chain', () => {
    const a = new Error('a')
    const b = new Error('b', { cause: a })
    ;(a as any).cause = b
    expect(() => describeError(a)).not.toThrow()
    expect(describeError(a)).toContain('[circular cause]')
  })

  it('handles non-Error throws', () => {
    expect(describeError('just a string')).toBe('just a string')
    expect(describeError({ code: 42 })).toContain('42')
    expect(describeError(undefined)).toBe('Unknown error')
  })
})

describe('errorHandler — unexpected 500s', () => {
  beforeEach(() => {
    captureProvider()
  })

  it('carries the error summary and stack outside production', () => {
    process.env.NODE_ENV = 'development'
    const res = mockRes()
    const err = new Error('relation "users" does not exist')
    errorHandler()(err, mockReq(), res, () => {})

    expect(res.statusCode).toBe(500)
    expect(res.body.message).toBe('Internal Server Error')
    expect(res.body.error).toContain('relation "users" does not exist')
    expect(Array.isArray(res.body.stack)).toBe(true)
  })

  it('stays opaque in production', () => {
    process.env.NODE_ENV = 'production'
    const res = mockRes()
    errorHandler()(new Error('connection string leaked here'), mockReq(), res, () => {})

    expect(res.statusCode).toBe(500)
    expect(res.body.message).toBe('Internal Server Error')
    expect(res.body.error).toBeUndefined()
    expect(res.body.stack).toBeUndefined()
    expect(JSON.stringify(res.body)).not.toContain('connection string')
  })

  it('includes requestId in production so the 500 ties to its log line', () => {
    process.env.NODE_ENV = 'production'
    const res = mockRes()
    const req = mockReq({ headers: { 'x-request-id': 'req-abc' } })
    errorHandler()(new Error('boom'), req, res, () => {})

    expect(res.body.requestId).toBe('req-abc')
  })

  it('prefers the request-scoped requestId over the raw header', () => {
    process.env.NODE_ENV = 'production'
    const res = mockRes()
    const req = mockReq({ requestId: 'scoped-1', headers: { 'x-request-id': 'header-1' } })
    errorHandler()(new Error('boom'), req, res, () => {})

    expect(res.body.requestId).toBe('scoped-1')
  })

  it('omits requestId entirely when none is available', () => {
    process.env.NODE_ENV = 'production'
    const res = mockRes()
    errorHandler()(new Error('boom'), mockReq(), res, () => {})
    expect('requestId' in res.body).toBe(false)
  })

  it('surfaces the cause chain in the dev body', () => {
    process.env.NODE_ENV = 'development'
    const res = mockRes()
    const err = new Error('findMany failed', {
      cause: new Error('relation "users" does not exist'),
    })
    errorHandler()(err, mockReq(), res, () => {})
    expect(res.body.error).toContain('relation "users" does not exist')
  })

  it('still passes non-500 statuses through with their own message', () => {
    process.env.NODE_ENV = 'production'
    const res = mockRes()
    const err: any = new Error('teapot')
    err.status = 418
    errorHandler()(err, mockReq(), res, () => {})

    expect(res.statusCode).toBe(418)
    expect(res.body.message).toBe('teapot')
  })

  it('logs the error object, not just a sentence', () => {
    const calls = captureProvider()
    process.env.NODE_ENV = 'production'
    const err = new Error('relation "users" does not exist')
    errorHandler()(err, mockReq(), mockRes(), () => {})

    expect(calls).toHaveLength(1)
    expect(calls[0].args).toContain(err)
    expect(calls[0].msg).toContain('GET /projects/42')
  })
})
