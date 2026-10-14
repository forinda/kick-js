import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import * as h3 from 'h3'
import { h3Runtime, h3WebRuntime } from '../src/http/runtimes/h3'

describe('h3Runtime() loading', () => {
  it('runs on the installed h3 v2', () => {
    expect(h3Runtime().name).toBe('h3')
    expect(h3Runtime({ h3 }).name).toBe('h3')
  })

  it('fails fast on h3 v1 with the upgrade command', () => {
    expect(() => h3Runtime({ h3: { createApp: () => ({}) } })).toThrow(/pnpm add h3@\^2/)
  })

  it('keeps h3WebRuntime as an alias', () => {
    expect(h3WebRuntime).toBe(h3Runtime)
  })
})
