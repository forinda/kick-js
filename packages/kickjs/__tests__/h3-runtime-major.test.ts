import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import * as h3v1 from 'h3'
import * as h3v2 from 'h3-v2'
import { h3Runtime } from '../src/http/runtimes/h3'
import { Logger } from '../src/core/logger'

describe('h3Runtime() follows the installed h3 major', () => {
  it('runs h3 v2 on the web-standard runtime', () => {
    expect(h3Runtime({ h3: h3v2 }).name).toBe('h3-web')
  })

  it('runs h3 v1 on the legacy runtime and warns once', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
    try {
      expect(h3Runtime({ h3: h3v1 }).name).toBe('h3')
      expect(h3Runtime().name).toBe('h3') // the installed peer here is v1
      const notices = warn.mock.calls.filter(([m]) => String(m).includes('h3 v1 is installed'))
      expect(notices).toHaveLength(1)
    } finally {
      warn.mockRestore()
    }
  })
})
