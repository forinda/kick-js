import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { session } from '../src/http/middleware/session'

const SECRET = 'test-secret-at-least-32-chars-xxxxxxxx'

function buildApp(opts: { withCookieParser: boolean }) {
  const app = express()
  app.use(express.json())
  if (opts.withCookieParser) {
    app.use((req, _res, next) => {
      const header = req.headers.cookie
      const parsed: Record<string, string> = {}
      if (header) {
        for (const pair of header.split(';')) {
          const eq = pair.indexOf('=')
          if (eq === -1) continue
          const k = pair.slice(0, eq).trim()
          const v = pair.slice(eq + 1).trim()
          parsed[k] = decodeURIComponent(v)
        }
      }
      ;(req as any).cookies = parsed
      next()
    })
  }
  app.use(session({ secret: SECRET, cookie: { secure: false } }))

  app.post('/login', async (req, res) => {
    ;(req as any).session.data.userId = 'u1'
    await (req as any).session.save()
    res.json({ ok: true })
  })

  app.get('/me', (req, res) => {
    const userId = (req as any).session.data.userId
    if (!userId) {
      res.status(401).json({ message: 'unauthenticated' })
      return
    }
    res.json({ userId })
  })

  return app
}

describe('session() middleware cookie handling', () => {
  it('persists session across requests without an upstream cookie parser', async () => {
    const app = buildApp({ withCookieParser: false })
    const agent = request.agent(app)

    const login = await agent.post('/login').send({})
    expect(login.status).toBe(200)
    expect(login.headers['set-cookie']).toBeDefined()

    const me = await agent.get('/me')
    expect(me.status).toBe(200)
    expect(me.body).toEqual({ userId: 'u1' })
  })

  it('persists session across requests when an upstream cookie parser is present', async () => {
    const app = buildApp({ withCookieParser: true })
    const agent = request.agent(app)

    const login = await agent.post('/login').send({})
    expect(login.status).toBe(200)

    const me = await agent.get('/me')
    expect(me.status).toBe(200)
    expect(me.body).toEqual({ userId: 'u1' })
  })

  it('issues a stable session id across requests (does not re-mint on every hit)', async () => {
    const app = buildApp({ withCookieParser: false })
    const agent = request.agent(app)

    await agent.post('/login').send({})
    const first = await agent.get('/me')
    const second = await agent.get('/me')
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(first.body.userId).toBe(second.body.userId)
  })

  it('rejects tampered session cookies and falls through to a fresh session', async () => {
    const app = buildApp({ withCookieParser: false })
    const res = await request(app)
      .get('/me')
      .set('Cookie', 'kick.sid=s:bogus.signature')
    expect(res.status).toBe(401)
  })
})
