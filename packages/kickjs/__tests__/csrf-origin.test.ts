import { afterEach, describe, expect, it } from 'vitest'
import express from 'express'
import request from 'supertest'
import { csrf, csrfToken, isAllowedOrigin } from '../src/http/middleware/csrf'

const none = new Set<string>()

describe('isAllowedOrigin', () => {
  it('passes same-origin fetch metadata', () => {
    expect(isAllowedOrigin({ 'sec-fetch-site': 'same-origin', host: 'a.test' }, none)).toBe(true)
  })

  it('matches Origin, or Referer, against the request host', () => {
    expect(isAllowedOrigin({ origin: 'https://a.test', host: 'a.test' }, none)).toBe(true)
    expect(isAllowedOrigin({ referer: 'https://a.test/form?x=1', host: 'a.test' }, none)).toBe(true)
    expect(isAllowedOrigin({ origin: 'https://evil.test', host: 'a.test' }, none)).toBe(false)
    // A sibling subdomain is another origin.
    expect(
      isAllowedOrigin(
        { origin: 'https://x.a.test', host: 'a.test', 'sec-fetch-site': 'same-site' },
        none,
      ),
    ).toBe(false)
    expect(isAllowedOrigin({ origin: 'null', host: 'a.test' }, none)).toBe(false)
  })

  it('compares Host and Origin after the same canonicalization', () => {
    // Default port, case: the same host however it is spelled.
    expect(isAllowedOrigin({ origin: 'https://a.test', host: 'A.TEST:443' }, none)).toBe(true)
    expect(isAllowedOrigin({ origin: 'http://a.test', host: 'a.test:80' }, none)).toBe(true)
    // A non-default port is part of the origin.
    expect(isAllowedOrigin({ origin: 'https://a.test', host: 'a.test:8443' }, none)).toBe(false)
    // HTTP/2 carries the host as :authority.
    expect(isAllowedOrigin({ origin: 'https://a.test', ':authority': 'a.test' }, none)).toBe(true)
  })

  it('never lets a malformed Host parse into a matching one', () => {
    for (const host of [
      'x@a.test',
      'a.test/',
      'a.test?',
      'a.test#',
      'a .test',
      'evil.test\\@a.test',
    ]) {
      expect(isAllowedOrigin({ origin: 'https://a.test', host }, none)).toBe(false)
    }
    // Only http(s) origins count.
    expect(isAllowedOrigin({ origin: 'file://a.test', host: 'a.test' }, none)).toBe(false)
  })

  it('accepts listed trusted origins', () => {
    const trusted = new Set(['https://app.a.test'])
    expect(isAllowedOrigin({ origin: 'https://app.a.test', host: 'api.a.test' }, trusted)).toBe(
      true,
    )
  })

  it('leaves requests without browser origin headers to the token', () => {
    expect(isAllowedOrigin({ host: 'a.test' }, none)).toBe(true)
    expect(isAllowedOrigin({ host: 'a.test', 'sec-fetch-site': 'none' }, none)).toBe(true)
    expect(isAllowedOrigin({ host: 'a.test', 'sec-fetch-site': 'cross-site' }, none)).toBe(false)
  })
})

describe('csrf() origin check', () => {
  const run = (headers: Record<string, string>, options = {}) => {
    let status = 0
    let nexted = false
    const res = {
      status: (code: number) => ((status = code), res),
      json: () => {},
      setHeader: () => {},
      getHeader: () => undefined,
    }
    csrf(options)(
      {
        method: 'POST',
        url: '/x',
        headers: { cookie: '_csrf=tok', 'x-csrf-token': 'tok', ...headers },
      } as never,
      res as never,
      (() => (nexted = true)) as never,
    )
    return { status, nexted }
  }

  it('refuses a cross-site request even with a valid token', () => {
    expect(run({ host: 'a.test', origin: 'https://evil.test' })).toEqual({
      status: 403,
      nexted: false,
    })
  })

  it('allows same-origin and trusted origins with a valid token', () => {
    expect(run({ host: 'a.test', origin: 'https://a.test' }).nexted).toBe(true)
    expect(
      run(
        { host: 'api.a.test', origin: 'https://app.a.test' },
        { trustedOrigins: ['https://app.a.test'] },
      ).nexted,
    ).toBe(true)
  })

  it('can be turned off', () => {
    expect(
      run({ host: 'a.test', origin: 'https://evil.test' }, { checkOrigin: false }).nexted,
    ).toBe(true)
  })

  it('rejects a trustedOrigins entry that is not an origin', () => {
    expect(() => csrf({ trustedOrigins: ['https://a.test/path'] })).toThrow(/origin/)
    expect(() => csrf({ trustedOrigins: ['app.a.test'] })).toThrow(/not an http\(s\) origin/)
  })
})

describe('csrf() form field', () => {
  it('takes the token from a parsed form body, after the body parser', async () => {
    const app = express()
    app.use(express.urlencoded({ extended: false }))
    app.use(csrf())
    app.get('/form', (req, res) => {
      res.send(String(csrfToken({ req })))
    })
    app.post('/save', (_req, res) => {
      res.send('saved')
    })
    const page = await request(app).get('/form')
    const token = page.text
    expect(String(page.headers['set-cookie'])).toContain(`_csrf=${token}`)
    const ok = await request(app)
      .post('/save')
      .set('cookie', `_csrf=${token}`)
      .type('form')
      .send(`_csrf=${token}`)
    expect(ok.text).toBe('saved')
    const bad = await request(app)
      .post('/save')
      .set('cookie', `_csrf=${token}`)
      .type('form')
      .send('_csrf=nope')
    expect(bad.status).toBe(403)
  })
})

describe('csrf cookie Secure flag', () => {
  const original = process.env.NODE_ENV
  afterEach(() => {
    if (original === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = original
  })

  const setCookie = async (nodeEnv: string | undefined) => {
    if (nodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = nodeEnv
    const app = express()
    app.use(csrf())
    app.get('/', (_req, res) => res.send('ok'))
    const res = await request(app).get('/')
    return String(res.headers['set-cookie'])
  }

  // Fails closed: an unset NODE_ENV must not hand out an insecure cookie.
  it('is Secure unless NODE_ENV is development or test', async () => {
    expect(await setCookie(undefined)).toMatch(/;\s*Secure/i)
    expect(await setCookie('production')).toMatch(/;\s*Secure/i)
    expect(await setCookie('development')).not.toMatch(/;\s*Secure/i)
    expect(await setCookie('test')).not.toMatch(/;\s*Secure/i)
  })
})
