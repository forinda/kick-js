import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { helmet } from '../src/middleware/helmet'

function createApp(options = {}) {
  const app = express()
  app.use(helmet(options))
  app.get('/', (_req, res) => res.json({ ok: true }))
  return app
}

describe('helmet middleware', () => {
  it('sets default security headers', async () => {
    const res = await request(createApp()).get('/').expect(200)

    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBe('DENY')
    expect(res.headers['x-xss-protection']).toBe('0')
    expect(res.headers['referrer-policy']).toBe('no-referrer')
    expect(res.headers['x-dns-prefetch-control']).toBe('off')
    expect(res.headers['strict-transport-security']).toMatch(/max-age=31536000/)
    expect(res.headers['x-powered-by']).toBeUndefined()
  })

  it('allows disabling individual headers', async () => {
    const res = await request(
      createApp({ frameguard: false, hsts: false, referrerPolicy: false }),
    )
      .get('/')
      .expect(200)

    expect(res.headers['x-frame-options']).toBeUndefined()
    expect(res.headers['strict-transport-security']).toBeUndefined()
    expect(res.headers['referrer-policy']).toBeUndefined()
  })

  it('supports SAMEORIGIN frameguard', async () => {
    const res = await request(createApp({ frameguard: 'SAMEORIGIN' }))
      .get('/')
      .expect(200)

    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN')
  })

  it('sets Content-Security-Policy when enabled', async () => {
    const res = await request(
      createApp({
        contentSecurityPolicy: {
          'default-src': ["'self'"],
          'script-src': ["'self'", 'https://cdn.example.com'],
        },
      }),
    )
      .get('/')
      .expect(200)

    expect(res.headers['content-security-policy']).toContain("default-src 'self'")
    expect(res.headers['content-security-policy']).toContain('https://cdn.example.com')
  })
})
