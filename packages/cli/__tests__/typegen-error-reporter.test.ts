import { describe, it, expect, vi } from 'vitest'

import { createTypegenErrorReporter } from '../src/commands/typegen-error-reporter'

describe('createTypegenErrorReporter', () => {
  it('emits on first failure, message includes source and error', () => {
    const emit = vi.fn()
    const r = createTypegenErrorReporter(emit)
    r.report('scan', new Error('boom'))
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit.mock.calls[0][0]).toContain('scan')
    expect(emit.mock.calls[0][0]).toContain('boom')
  })

  it('suppresses repeats of the same message for the same source', () => {
    const emit = vi.fn()
    const r = createTypegenErrorReporter(emit)
    r.report('scan', new Error('boom'))
    r.report('scan', new Error('boom'))
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it('re-emits when the message changes', () => {
    const emit = vi.fn()
    const r = createTypegenErrorReporter(emit)
    r.report('scan', new Error('boom'))
    r.report('scan', new Error('different'))
    expect(emit).toHaveBeenCalledTimes(2)
  })

  it('clear() re-arms so an identical failure emits again', () => {
    const emit = vi.fn()
    const r = createTypegenErrorReporter(emit)
    r.report('scan', new Error('boom'))
    r.clear('scan')
    r.report('scan', new Error('boom'))
    expect(emit).toHaveBeenCalledTimes(2)
  })

  it('tracks sources independently', () => {
    const emit = vi.fn()
    const r = createTypegenErrorReporter(emit)
    r.report('scan', new Error('boom'))
    r.report('plugins', new Error('boom'))
    expect(emit).toHaveBeenCalledTimes(2)
  })

  it('stringifies non-Error rejection values', () => {
    const emit = vi.fn()
    const r = createTypegenErrorReporter(emit)
    r.report('scan', 'string failure')
    expect(emit.mock.calls[0][0]).toContain('string failure')
  })
})
