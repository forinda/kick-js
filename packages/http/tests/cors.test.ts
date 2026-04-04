import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { cors } from '../src/middleware/cors'

function createApp(options = {}) {
  const app = express()
  app.use(cors(options))
  app.get('/', (_req, res) => res.json({ ok: true }))
  return app
}

describe('cors middleware', () => {
  it('rejects cross-origin by default (restrictive)', async () => {
    const res = await request(createApp()).get('/').set('Origin', 'https://evil.com').expect(200)
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('allows all origins when explicitly set to *', async () => {
    const res = await request(createApp({ origin: '*' })).get('/').expect(200)
    expect(res.headers['access-control-allow-origin']).toBe('*')
  })

  it('reflects origin from allowlist and sets Vary', async () => {
    const app = createApp({ origin: ['https://app.example.com'] })

    const res = await request(app)
      .get('/')
      .set('Origin', 'https://app.example.com')
      .expect(200)

    expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com')
    expect(res.headers['vary']).toContain('Origin')
  })

  it('does not set origin for non-matching requests', async () => {
    const app = createApp({ origin: ['https://allowed.com'] })

    const res = await request(app)
      .get('/')
      .set('Origin', 'https://evil.com')
      .expect(200)

    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('supports regex origin matching', async () => {
    const app = createApp({ origin: /\.example\.com$/ })

    const res = await request(app)
      .get('/')
      .set('Origin', 'https://sub.example.com')
      .expect(200)

    expect(res.headers['access-control-allow-origin']).toBe('https://sub.example.com')
  })

  it('handles preflight OPTIONS with 204', async () => {
    const app = createApp({ origin: true })

    const res = await request(app)
      .options('/')
      .set('Origin', 'https://app.example.com')
      .set('Access-Control-Request-Method', 'POST')
      .expect(204)

    expect(res.headers['access-control-allow-methods']).toContain('POST')
    expect(res.headers['access-control-max-age']).toBe('86400')
  })

  it('sets credentials header when enabled', async () => {
    const app = createApp({ origin: true, credentials: true })

    const res = await request(app)
      .get('/')
      .set('Origin', 'https://app.example.com')
      .expect(200)

    expect(res.headers['access-control-allow-credentials']).toBe('true')
    expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com')
  })

  it('exposes custom headers', async () => {
    const app = createApp({ exposedHeaders: ['X-Request-Id', 'X-Total-Count'] })

    const res = await request(app).get('/').expect(200)

    expect(res.headers['access-control-expose-headers']).toBe(
      'X-Request-Id, X-Total-Count',
    )
  })
})
