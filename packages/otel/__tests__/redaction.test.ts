import { describe, expect, it, vi } from 'vitest'
import { OtelAdapter } from '@forinda/kickjs-otel'

describe('OtelAdapter.applyRedaction', () => {
  it('is identity when no sensitiveKeys or redactAttribute is configured', () => {
    const a = OtelAdapter()
    const attrs = { 'http.method': 'GET', 'http.status_code': 200, foo: 'bar' }
    expect(a.applyRedaction(attrs)).toEqual(attrs)
  })

  it('masks string-key matches case-insensitively', () => {
    const a = OtelAdapter({ sensitiveKeys: ['password', 'token'] })
    const out = a.applyRedaction({
      password: 'hunter2',
      PASSWORD: 'HUNTER2',
      Token: 'abc',
      safe: 'yes',
    })
    expect(out).toEqual({
      password: '[REDACTED]',
      PASSWORD: '[REDACTED]',
      Token: '[REDACTED]',
      safe: 'yes',
    })
  })

  it('masks RegExp key matches verbatim (no case coercion)', () => {
    const a = OtelAdapter({ sensitiveKeys: [/^x-api-key/i, /^authorization$/i] })
    const out = a.applyRedaction({
      'X-API-Key': 'sk_live_1',
      'x-api-key-v2': 'sk_live_2',
      authorization: 'Bearer abc',
      Authorization: 'Bearer abc',
      'x-trace-id': 'trace-1',
    })
    expect(out).toEqual({
      'X-API-Key': '[REDACTED]',
      'x-api-key-v2': '[REDACTED]',
      authorization: '[REDACTED]',
      Authorization: '[REDACTED]',
      'x-trace-id': 'trace-1',
    })
  })

  it('custom redactAttribute takes precedence and sees both key and value', () => {
    const redact = vi.fn((_key: string, value: unknown) =>
      typeof value === 'string' && /\d{16}/.test(value) ? '[REDACTED]' : value,
    )
    const a = OtelAdapter({
      sensitiveKeys: ['should-be-ignored-when-custom-set'],
      redactAttribute: redact,
    })
    const out = a.applyRedaction({
      card: '4111111111111111',
      note: 'ok',
      'should-be-ignored-when-custom-set': 'still-leaks-because-custom-wins',
    })
    expect(out.card).toBe('[REDACTED]')
    expect(out.note).toBe('ok')
    // sensitiveKeys is bypassed entirely when redactAttribute is set
    expect(out['should-be-ignored-when-custom-set']).toBe('still-leaks-because-custom-wins')
    expect(redact).toHaveBeenCalledTimes(3)
  })

  it('preserves non-string attribute values', () => {
    const a = OtelAdapter({ sensitiveKeys: ['password'] })
    const out = a.applyRedaction({
      'http.status_code': 200,
      'http.is_error': false,
      password: 'secret',
    })
    expect(out).toEqual({
      'http.status_code': 200,
      'http.is_error': false,
      password: '[REDACTED]',
    })
  })

  it('empty sensitiveKeys array is treated as no-op', () => {
    const a = OtelAdapter({ sensitiveKeys: [] })
    expect(a.applyRedaction({ password: 'x' })).toEqual({ password: 'x' })
  })
})
