import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import {
  HttpException,
  ProblemException,
  Problems,
  defaultProblemTitle,
  normalizeProblem,
  type ProblemDetails,
} from '../src/core'
import { errorHandler } from '../src/http/middleware/error-handler'
import { RequestContext } from '../src/http/context'

// ── ProblemException class ────────────────────────────────────────────

describe('ProblemException', () => {
  it('fills in default `title` from the IANA reason phrase when omitted', () => {
    const ex = new ProblemException({ status: 404 })
    expect(ex.problem.title).toBe('Not Found')
  })

  it('fills in default `detail` from `title` when omitted', () => {
    const ex = new ProblemException({ status: 403 })
    expect(ex.message).toBe('Forbidden')
  })

  it('preserves caller-supplied `type`, `title`, `detail`, `instance`', () => {
    const ex = new ProblemException({
      type: 'https://api.example.com/probs/out-of-credit',
      status: 403,
      title: 'You do not have enough credit',
      detail: 'Your balance is 30, but that costs 50.',
      instance: '/account/123/messages/abc',
    })
    expect(ex.problem.type).toBe('https://api.example.com/probs/out-of-credit')
    expect(ex.problem.title).toBe('You do not have enough credit')
    expect(ex.problem.detail).toBe('Your balance is 30, but that costs 50.')
    expect(ex.problem.instance).toBe('/account/123/messages/abc')
  })

  it('preserves extension members per §3.2', () => {
    const ex = new ProblemException({ status: 403, balance: 30, accounts: ['/a/1', '/a/2'] })
    expect(ex.problem.balance).toBe(30)
    expect(ex.problem.accounts).toEqual(['/a/1', '/a/2'])
  })

  it('extends HttpException so plain HttpException catches still see it', () => {
    const ex = Problems.notFound()
    expect(ex).toBeInstanceOf(HttpException)
    expect(ex).toBeInstanceOf(ProblemException)
  })

  it('exposes `status` directly for parity with HttpException', () => {
    const ex = Problems.conflict()
    expect(ex.status).toBe(409)
  })
})

describe('Problems convenience factories', () => {
  it('badRequest', () => {
    const ex = Problems.badRequest({ detail: 'invalid' })
    expect(ex.problem.status).toBe(400)
    expect(ex.problem.title).toBe('Bad Request')
    expect(ex.problem.detail).toBe('invalid')
  })

  it('unauthorized — sets WWW-Authenticate when challenge passed', () => {
    const ex = Problems.unauthorized({}, 'Bearer realm="api"')
    expect(ex.problem.status).toBe(401)
    expect(ex.headers).toEqual({ 'WWW-Authenticate': 'Bearer realm="api"' })
  })

  it('forbidden', () => {
    const ex = Problems.forbidden({ detail: 'no access' })
    expect(ex.problem.status).toBe(403)
    expect(ex.problem.detail).toBe('no access')
  })

  it('notFound', () => {
    const ex = Problems.notFound({ detail: 'user 123 not found' })
    expect(ex.problem.status).toBe(404)
    expect(ex.problem.detail).toBe('user 123 not found')
  })

  it('methodNotAllowed — sets Allow header from allowedMethods', () => {
    const ex = Problems.methodNotAllowed(['GET', 'POST'])
    expect(ex.problem.status).toBe(405)
    expect(ex.headers).toEqual({ Allow: 'GET, POST' })
  })

  it('conflict', () => {
    const ex = Problems.conflict({ detail: 'email taken' })
    expect(ex.problem.status).toBe(409)
    expect(ex.problem.detail).toBe('email taken')
  })

  it('unprocessable', () => {
    const ex = Problems.unprocessable({ errors: [{ field: 'email' }] })
    expect(ex.problem.status).toBe(422)
    expect(ex.problem.errors).toEqual([{ field: 'email' }])
  })

  it('tooManyRequests — sets Retry-After when seconds passed', () => {
    const ex = Problems.tooManyRequests({}, 60)
    expect(ex.problem.status).toBe(429)
    expect(ex.headers).toEqual({ 'Retry-After': '60' })
  })

  it('serviceUnavailable — sets Retry-After when seconds passed', () => {
    const ex = Problems.serviceUnavailable({}, 30)
    expect(ex.problem.status).toBe(503)
    expect(ex.headers).toEqual({ 'Retry-After': '30' })
  })

  it('internal', () => {
    const ex = Problems.internal()
    expect(ex.problem.status).toBe(500)
    expect(ex.problem.title).toBe('Internal Server Error')
  })

  it('fromZodError — wraps Zod issues into the §3.2 errors extension', () => {
    const zodError = {
      issues: [
        { path: ['email'], message: 'Invalid email', code: 'invalid_string' },
        { path: ['name'], message: 'Required', code: 'invalid_type' },
      ],
    }
    const ex = Problems.fromZodError(zodError as any)
    expect(ex.problem.status).toBe(422)
    expect(ex.problem.detail).toBe('Invalid email')
    expect(ex.problem.errors).toEqual([
      { field: 'email', message: 'Invalid email', code: 'invalid_string' },
      { field: 'name', message: 'Required', code: 'invalid_type' },
    ])
  })
})

describe('ProblemException.withHeaders', () => {
  it('returns a fresh exception with merged headers', () => {
    const a = Problems.tooManyRequests({}, 60)
    const b = a.withHeaders({ 'X-Custom': 'yes' })
    expect(b).not.toBe(a)
    expect(b.headers).toEqual({ 'Retry-After': '60', 'X-Custom': 'yes' })
    expect(b.problem.status).toBe(429)
  })
})

// ── normalizeProblem / defaultProblemTitle ─────────────────────────────

describe('normalizeProblem', () => {
  it("fills `type` → 'about:blank' when omitted (RFC 9457 §3.1.1)", () => {
    const out = normalizeProblem({ status: 404 })
    expect(out.type).toBe('about:blank')
  })

  it('fills `title` → IANA reason when omitted (§3.1.4)', () => {
    const out = normalizeProblem({ status: 403 })
    expect(out.title).toBe('Forbidden')
  })

  it('preserves caller-supplied `type` and `title`', () => {
    const out = normalizeProblem({
      type: 'https://api.example.com/probs/x',
      status: 400,
      title: 'Custom',
    })
    expect(out.type).toBe('https://api.example.com/probs/x')
    expect(out.title).toBe('Custom')
  })

  it('preserves extension members', () => {
    const out = normalizeProblem({ status: 400, foo: 'bar', count: 7 })
    expect(out.foo).toBe('bar')
    expect(out.count).toBe(7)
  })

  it("falls back to defaults when caller passes explicit `undefined` (CodeRabbit regression)", () => {
    // A partial built from optional fields can land here with type/title
    // explicitly undefined. Spreading after the defaults would re-override
    // them; spreading first preserves the fallback.
    const maybeUrl: string | undefined = undefined
    const out = normalizeProblem({ status: 404, type: maybeUrl, title: undefined })
    expect(out.type).toBe('about:blank')
    expect(out.title).toBe('Not Found')
  })
})

describe('defaultProblemTitle', () => {
  it('maps known status codes to their IANA reason phrase', () => {
    expect(defaultProblemTitle(400)).toBe('Bad Request')
    expect(defaultProblemTitle(404)).toBe('Not Found')
    expect(defaultProblemTitle(500)).toBe('Internal Server Error')
  })

  it("returns 'Error' for codes outside the table", () => {
    expect(defaultProblemTitle(418)).toBe('Error')
    expect(defaultProblemTitle(999)).toBe('Error')
  })
})

// ── Error handler emitting application/problem+json ────────────────────

function appThrowing(err: Error) {
  const app = express()
  app.use(express.json())
  app.get('/boom', (_req, _res, next) => next(err))
  app.use(errorHandler())
  return app
}

describe('errorHandler — ProblemException', () => {
  it('emits Content-Type application/problem+json', async () => {
    const res = await request(appThrowing(Problems.notFound())).get('/boom')
    expect(res.status).toBe(404)
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/)
  })

  it('serializes the canonical RFC 9457 shape with type defaulted to about:blank', async () => {
    const res = await request(appThrowing(Problems.notFound())).get('/boom')
    expect(res.body).toEqual({ type: 'about:blank', title: 'Not Found', status: 404 })
  })

  it('passes through caller-supplied type, detail, instance, and extensions', async () => {
    const ex = new ProblemException({
      type: 'https://api.example.com/probs/out-of-credit',
      status: 403,
      title: 'You do not have enough credit',
      detail: 'Your balance is 30, but that costs 50.',
      instance: '/account/123/messages/abc',
      balance: 30,
    })
    const res = await request(appThrowing(ex)).get('/boom')
    expect(res.status).toBe(403)
    expect(res.body).toEqual({
      type: 'https://api.example.com/probs/out-of-credit',
      status: 403,
      title: 'You do not have enough credit',
      detail: 'Your balance is 30, but that costs 50.',
      instance: '/account/123/messages/abc',
      balance: 30,
    })
  })

  it('forwards exception headers (Retry-After, WWW-Authenticate, Allow)', async () => {
    const ex = Problems.tooManyRequests({}, 60)
    const res = await request(appThrowing(ex)).get('/boom')
    expect(res.status).toBe(429)
    expect(res.headers['retry-after']).toBe('60')
  })

  it('keeps existing JSON shape for plain HttpException (backward compat)', async () => {
    const ex = new HttpException(404, 'Old shape')
    const res = await request(appThrowing(ex)).get('/boom')
    expect(res.status).toBe(404)
    expect(res.headers['content-type']).toMatch(/^application\/json/)
    expect(res.body).toEqual({ message: 'Old shape' })
  })
})

// ── ctx.problem — direct response helpers ─────────────────────────────

function appWithCtx(handler: (ctx: RequestContext) => unknown) {
  const app = express()
  app.use(express.json())
  app.get('/test', (req, res, next) => {
    const ctx = new RequestContext(req, res, next)
    Promise.resolve(handler(ctx)).catch(next)
  })
  app.use(errorHandler())
  return app
}

describe('ctx.problem — direct helpers', () => {
  it('ctx.problem(input) sets application/problem+json and serializes canonical shape', async () => {
    const res = await request(
      appWithCtx((ctx) => ctx.problem({ status: 403, detail: 'no access' })),
    ).get('/test')
    expect(res.status).toBe(403)
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/)
    expect(res.body).toEqual({
      type: 'about:blank',
      title: 'Forbidden',
      status: 403,
      detail: 'no access',
    })
  })

  it('ctx.problem.notFound pre-fills status 404 and title "Not Found"', async () => {
    const res = await request(appWithCtx((ctx) => ctx.problem.notFound())).get('/test')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ type: 'about:blank', title: 'Not Found', status: 404 })
  })

  it('ctx.problem.badRequest accepts detail and extensions', async () => {
    const res = await request(
      appWithCtx((ctx) =>
        ctx.problem.badRequest({ detail: 'invalid input', field: 'email' } as any),
      ),
    ).get('/test')
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: 'invalid input',
      field: 'email',
    })
  })

  it('ctx.problem.unauthorized pre-fills status 401', async () => {
    const res = await request(appWithCtx((ctx) => ctx.problem.unauthorized())).get('/test')
    expect(res.status).toBe(401)
    expect(res.body.title).toBe('Unauthorized')
  })

  it('ctx.problem.forbidden pre-fills status 403', async () => {
    const res = await request(appWithCtx((ctx) => ctx.problem.forbidden())).get('/test')
    expect(res.status).toBe(403)
    expect(res.body.title).toBe('Forbidden')
  })

  it('ctx.problem.conflict pre-fills status 409', async () => {
    const res = await request(appWithCtx((ctx) => ctx.problem.conflict())).get('/test')
    expect(res.status).toBe(409)
    expect(res.body.title).toBe('Conflict')
  })

  it('ctx.problem.unprocessable pre-fills status 422', async () => {
    const res = await request(appWithCtx((ctx) => ctx.problem.unprocessable())).get('/test')
    expect(res.status).toBe(422)
    expect(res.body.title).toBe('Unprocessable Entity')
  })

  it('ctx.problem.tooManyRequests pre-fills status 429', async () => {
    const res = await request(appWithCtx((ctx) => ctx.problem.tooManyRequests())).get('/test')
    expect(res.status).toBe(429)
    expect(res.body.title).toBe('Too Many Requests')
  })

  it('ctx.problem.internal pre-fills status 500', async () => {
    const res = await request(appWithCtx((ctx) => ctx.problem.internal())).get('/test')
    expect(res.status).toBe(500)
    expect(res.body.title).toBe('Internal Server Error')
  })

  it('ctx.problem.validation serializes Zod issues into the §3.2 errors extension', async () => {
    const issues = [
      { path: ['email'], message: 'Invalid email', code: 'invalid_string' },
      { path: ['name'], message: 'Required', code: 'invalid_type' },
    ]
    const res = await request(appWithCtx((ctx) => ctx.problem.validation(issues))).get('/test')
    expect(res.status).toBe(422)
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/)
    expect(res.body).toMatchObject({
      type: 'about:blank',
      title: 'Unprocessable Entity',
      status: 422,
      detail: 'Invalid email',
      errors: [
        { field: 'email', message: 'Invalid email', code: 'invalid_string' },
        { field: 'name', message: 'Required', code: 'invalid_type' },
      ],
    })
  })

  it('extension fields pass through unchanged', async () => {
    const res = await request(
      appWithCtx((ctx) =>
        ctx.problem({
          type: 'https://api.example.com/probs/out-of-credit',
          status: 403,
          detail: 'no credit',
          balance: 30,
          accounts: ['/a/1', '/a/2'],
        } as ProblemDetails),
      ),
    ).get('/test')
    expect(res.body.balance).toBe(30)
    expect(res.body.accounts).toEqual(['/a/1', '/a/2'])
  })
})
