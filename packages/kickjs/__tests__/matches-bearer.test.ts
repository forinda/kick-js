import { describe, expect, it } from 'vitest'
import { matchesBearer } from '@forinda/kickjs'
import { matchesBearer as webMatchesBearer } from '../src/web'

describe('matchesBearer', () => {
  it('is public from the root and the web entry', () => {
    expect(webMatchesBearer).toBe(matchesBearer)
  })

  it('accepts exactly "Bearer <secret>"', () => {
    expect(matchesBearer('Bearer s3cret', 's3cret')).toBe(true)
  })

  it.each([
    ['wrong secret', 'Bearer nope'],
    ['a prefix of it', 'Bearer s3cre'],
    ['a longer value', 'Bearer s3cret!'],
    ['another scheme', 'Basic s3cret'],
    ['the bare secret', 's3cret'],
    ['a missing header', undefined],
    ['a repeated header', ['Bearer s3cret']],
  ])('rejects %s', (_, header) => {
    expect(matchesBearer(header, 's3cret')).toBe(false)
  })
})
