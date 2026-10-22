import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { HttpException } from '../src/core/errors'
import { formErrorHandler } from '../src/http/middleware/form-errors'
import { session } from '../src/http/middleware/session'

const SECRET = 'test-secret-at-least-32-chars-xxxxxxxx'

type Fallback = Parameters<typeof formErrorHandler>[0]

function app(opts: { withSession?: boolean; fallback?: Fallback; fallbackUrl?: string } = {}) {
  const a = express()
  a.use(express.urlencoded({ extended: false }))
  a.use(express.json())
  if (opts.withSession !== false) a.use(session({ secret: SECRET, cookie: { secure: false } }))
  a.post('/products', () => {
    throw new HttpException(422, 'Invalid', [{ field: 'title', message: 'Too short' }])
  })
  a.get('/session', (req, res) => {
    res.json((req as unknown as { session: { data: unknown } }).session.data)
  })
  const handler = formErrorHandler(opts.fallback, { fallbackUrl: opts.fallbackUrl })
  a.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) =>
    handler(err, req, res as never, next),
  )
  return a
}

/** A fallback that answers 422, so a test can see it ran. */
const spyFallback = () =>
  vi.fn((_err, _req, res) => {
    res.status(422).end()
  }) as unknown as NonNullable<Fallback> & ReturnType<typeof vi.fn>

describe('formErrorHandler', () => {
  it('redirects a form post back with errors and old input', async () => {
    const agent = request.agent(app())
    const res = await agent
      .post('/products')
      .type('form')
      .set('Referer', 'http://127.0.0.1/products/new?step=2')
      .set('Host', '127.0.0.1')
      .send('title=a&password=p')
    expect(res.status).toBe(303)
    expect(res.headers.location).toBe('/products/new?step=2')
    const data = (await agent.get('/session')).body
    expect(data.__inertia_errors).toEqual({ title: 'Too short' })
    expect(data.__kick_old).toEqual({ title: 'a' })
  })

  it('redirects to fallbackUrl for a foreign Referer', async () => {
    const post = (a: express.Express, referer?: string) => {
      const r = request(a).post('/products').type('form').set('Host', '127.0.0.1')
      return (referer ? r.set('Referer', referer) : r).send('title=a')
    }
    expect((await post(app(), 'https://evil.example/x')).headers.location).toBe('/')
    expect(
      (await post(app({ fallbackUrl: '/dashboard' }), 'https://evil.example/x')).headers.location,
    ).toBe('/dashboard')
    expect((await post(app())).headers.location).toBe('/')
  })

  it('never redirects to a path another site could own', async () => {
    const post = (referer: string) =>
      request(app())
        .post('/products')
        .type('form')
        .set('Host', '127.0.0.1')
        .set('Referer', referer)
        .send('title=a')
    // `//evil.example/x` is a link to another site, and so is `/\evil.example`.
    expect((await post('http://127.0.0.1//evil.example/x')).headers.location).toBe('/')
    expect((await post('http://127.0.0.1/%5Cevil.example')).headers.location).toBe(
      '/%5Cevil.example',
    )
    expect((await post('http://127.0.0.1/ok?a=1')).headers.location).toBe('/ok?a=1')
  })

  it('leaves Inertia and JSON requests to the fallback', async () => {
    const fallback = spyFallback()
    const a = app({ fallback })
    expect(
      (await request(a).post('/products').type('form').set('x-inertia', 'true').send('title=a'))
        .status,
    ).toBe(422)
    expect((await request(a).post('/products').send({ title: 'a' })).status).toBe(422)
    expect(fallback).toHaveBeenCalledTimes(2)
  })

  it('keeps errors when old input is dropped', async () => {
    const agent = request.agent(app())
    const big = (c: string) => c.repeat(900)
    await agent
      .post('/products')
      .type('form')
      .send({ a: big('x'), b: big('y'), c: big('z') })
    const data = (await agent.get('/session')).body
    expect(data.__inertia_errors).toEqual({ title: 'Too short' })
    expect(data.__kick_old).toBeUndefined()
  })

  it('falls back without a session', async () => {
    const fallback = spyFallback()
    const res = await request(app({ withSession: false, fallback }))
      .post('/products')
      .type('form')
      .send('title=a')
    expect(res.status).toBe(422)
    expect(fallback).toHaveBeenCalledTimes(1)
  })
})
