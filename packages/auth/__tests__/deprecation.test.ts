import { describe, it, expect, vi, afterEach } from 'vitest'

import { warnDeprecated } from '../src/deprecation'

afterEach(() => vi.restoreAllMocks())

describe('deprecation warning', () => {
  it('warns by default and points at the BYO auth recipe', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(warnDeprecated({})).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toContain('deprecated')
    expect(spy.mock.calls[0][0]).toContain('BYO')
    expect(spy.mock.calls[0][0]).toContain('defineContextDecorator')
  })

  it('is suppressed via KICKJS_SUPPRESS_DEPRECATION=1 or =true', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(warnDeprecated({ KICKJS_SUPPRESS_DEPRECATION: '1' })).toBe(false)
    expect(warnDeprecated({ KICKJS_SUPPRESS_DEPRECATION: 'true' })).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })

  it('still warns when KICKJS_SUPPRESS_DEPRECATION=0', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(warnDeprecated({ KICKJS_SUPPRESS_DEPRECATION: '0' })).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
