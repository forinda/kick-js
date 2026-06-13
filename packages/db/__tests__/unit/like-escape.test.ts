import { describe, it, expect } from 'vitest'

import { escapeLike, likePattern } from '../../src/query/like'

describe('escapeLike', () => {
  it('escapes % and _ wildcards', () => {
    expect(escapeLike('100%')).toBe('100\\%')
    expect(escapeLike('a_b')).toBe('a\\_b')
  })

  it('escapes the escape char before adding new ones (no double-escape)', () => {
    expect(escapeLike('a\\b')).toBe('a\\\\b')
    expect(escapeLike('50%\\_')).toBe('50\\%\\\\\\_')
  })

  it('leaves ordinary text untouched', () => {
    expect(escapeLike('john.doe@example.com')).toBe('john.doe@example.com')
  })

  it('honours a custom escape char', () => {
    expect(escapeLike('a%b', '!')).toBe('a!%b')
  })

  it('rejects an invalid escape char (empty, multi-char, or a wildcard)', () => {
    expect(() => escapeLike('x', '')).toThrow(/single character/)
    expect(() => escapeLike('x', '!!')).toThrow(/single character/)
    expect(() => escapeLike('x', '%')).toThrow(/'%' or '_'/)
    expect(() => escapeLike('x', '_')).toThrow(/'%' or '_'/)
  })
})

describe('likePattern', () => {
  it('wraps escaped input per mode', () => {
    expect(likePattern('john', 'contains')).toBe('%john%')
    expect(likePattern('admin', 'startsWith')).toBe('admin%')
    expect(likePattern('.com', 'endsWith')).toBe('%.com')
    expect(likePattern('exact', 'exact')).toBe('exact')
  })

  it('escapes wildcards inside the input so they match literally', () => {
    // A user typing "100%" should not become a match-all pattern.
    expect(likePattern('100%', 'contains')).toBe('%100\\%%')
  })

  it('defaults to contains', () => {
    expect(likePattern('x')).toBe('%x%')
  })

  it('throws on an unsupported mode (JS caller / as-any)', () => {
    expect(() => likePattern('x', 'bogus' as never)).toThrow(/unsupported match mode/)
  })
})
