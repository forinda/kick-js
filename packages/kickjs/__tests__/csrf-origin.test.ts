import { describe, expect, it } from 'vitest'
import { csrf, isAllowedOrigin } from '../src/http/middleware/csrf'

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
    expect(() => csrf({ trustedOrigins: ['app.a.test'] })).toThrow(/not a URL origin/)
  })
})
