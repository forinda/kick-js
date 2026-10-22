import { describe, expect, it } from 'vitest'
import { fieldErrors, flash, oldInput, SECRET_FIELD } from '../src/http/form'

describe('flash', () => {
  it('flash merges into the session and throws without one', () => {
    const ctx = { session: { data: {} as Record<string, unknown> } }
    flash(ctx, { success: 'a' })
    flash(ctx, { info: 'b' })
    expect(ctx.session.data.__inertia_flash).toEqual({ success: 'a', info: 'b' })
    expect(() => flash({}, {})).toThrow('flash() needs the session() middleware.')
  })
})

describe('fieldErrors', () => {
  it('fieldErrors keeps the first message per field', () => {
    expect(
      fieldErrors([
        { field: 'title', message: 'Too short' },
        { field: 'title', message: 'x' },
        { field: '', message: 'Bad form' },
      ]),
    ).toEqual({ title: 'Too short', form: 'Bad form' })
    expect(fieldErrors('x')).toBeNull()
  })
})

describe('oldInput', () => {
  it('oldInput keeps strings, leaves out secrets, files and long fields', () => {
    expect(
      oldInput({
        title: 'Hi',
        tags: ['a', 'b'],
        password: 'p',
        api_token: 't',
        card_number: '4',
        _csrf: 'c',
        photo: { name: 'f.png' },
        bio: 'x'.repeat(1001),
      }),
    ).toEqual({ title: 'Hi', tags: ['a', 'b'] })
  })
  it('drops all old input over the total cap', () => {
    expect(oldInput({ a: 'x'.repeat(900), b: 'y'.repeat(900), c: 'z'.repeat(900) })).toBeUndefined()
  })
})

describe('oldInput limits', () => {
  it('counts UTF-8 bytes, not characters', () => {
    // 600 characters, but 1,800 bytes of UTF-8: over the total.
    expect(oldInput({ a: '漢'.repeat(300), b: '字'.repeat(300) })).toBeUndefined()
    expect(oldInput({ a: 'x'.repeat(300), b: 'y'.repeat(300) })).toBeDefined()
  })
  it('leaves out short password-like names too', () => {
    expect(oldInput({ pwd: 'a', pin: '1', otp: '2', pin_code: '3', spinner: 's' })).toEqual({
      spinner: 's',
    })
    expect(SECRET_FIELD.test('pwd')).toBe(true)
  })
})

describe('review: field names', () => {
  it('keeps fields named like object properties', () => {
    expect(fieldErrors([{ field: 'constructor', message: 'Required' }])?.constructor).toBe(
      'Required',
    )
    expect(oldInput({ toString: 'x' })?.toString).toBe('x')
  })
})
