import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { _setValidationErrorFactory, validate } from '../src/http/middleware/validate'
import { HttpException } from '../src/core/errors'

const run = (body: unknown) => {
  const next = vi.fn()
  validate({ body: z.object({ title: z.string().min(1) }) })({ body } as never, {} as never, next)
  return next.mock.calls[0][0]
}

afterEach(() => _setValidationErrorFactory(undefined))

describe('validation error factory', () => {
  it('defaults to a 422 HttpException with field details', () => {
    const err = run({ title: '' })
    expect(err).toBeInstanceOf(HttpException)
    expect(err.status).toBe(422)
    expect(err.details).toEqual([{ field: 'title', message: expect.any(String) }])
  })

  it('uses what the factory throws, as well as what it returns', () => {
    const custom = new Error('nope')
    _setValidationErrorFactory(() => {
      throw custom
    })
    expect(run({ title: '' })).toBe(custom)
  })

  it('is not consulted for a valid request', () => {
    const factory = vi.fn()
    _setValidationErrorFactory(factory)
    expect(run({ title: 'ok' })).toBeUndefined()
    expect(factory).not.toHaveBeenCalled()
  })
})
