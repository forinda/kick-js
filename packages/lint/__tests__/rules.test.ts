import { describe, it, expect } from 'vitest'
import { diTokenSymbol, tokenKickPrefix, tokenReservedPrefix } from '../src/rules'

describe('di-token-symbol', () => {
  it('flags `export const X = Symbol(...)` declarations', () => {
    const v = diTokenSymbol.check({
      source: `export const FOO = Symbol('Foo')`,
      file: 'pkg/types.ts',
      firstParty: true,
    })
    expect(v).toHaveLength(1)
    expect(v[0]).toMatchObject({
      ruleId: 'di-token-symbol',
      severity: 'error',
      file: 'pkg/types.ts',
      line: 1,
    })
    expect(v[0].message).toContain('FOO')
    expect(v[0].suggestion).toContain('createToken')
  })

  it('honours the inline-disable comment', () => {
    const v = diTokenSymbol.check({
      source: `export const FOO = Symbol('Foo') // kick-lint-disable di-token-symbol`,
      file: 'pkg/types.ts',
      firstParty: true,
    })
    expect(v).toEqual([])
  })

  it('does not flag non-exported Symbol uses', () => {
    const v = diTokenSymbol.check({
      source: `const internal = Symbol('something')`,
      file: 'pkg/types.ts',
      firstParty: true,
    })
    expect(v).toEqual([])
  })

  it('reports correct line numbers for multi-line files', () => {
    const v = diTokenSymbol.check({
      source: ['// header', '', 'export const FOO = Symbol("Foo")'].join('\n'),
      file: 'pkg/types.ts',
      firstParty: true,
    })
    expect(v[0].line).toBe(3)
  })
})

describe('token-kick-prefix', () => {
  it('flags first-party tokens missing the kick/ prefix', () => {
    const v = tokenKickPrefix.check({
      source: `const FOO = createToken<Foo>('mailer/Service')`,
      file: 'packages/mailer/src/types.ts',
      firstParty: true,
    })
    expect(v).toHaveLength(1)
    expect(v[0].suggestion).toContain('kick/mailer/Service')
  })

  it('passes when the prefix is present', () => {
    const v = tokenKickPrefix.check({
      source: `const FOO = createToken<Foo>('kick/mailer/Service')`,
      file: 'packages/mailer/src/types.ts',
      firstParty: true,
    })
    expect(v).toEqual([])
  })

  it('allows the legacy kickjs.* dotted form', () => {
    const v = tokenKickPrefix.check({
      source: `const FOO = createToken<Foo>('kickjs.ai.provider')`,
      file: 'packages/ai/src/constants.ts',
      firstParty: true,
    })
    expect(v).toEqual([])
  })

  it('does nothing for third-party callers', () => {
    const v = tokenKickPrefix.check({
      source: `const FOO = createToken<Foo>('whatever/MyToken')`,
      file: 'mycorp/src/types.ts',
      firstParty: false,
    })
    expect(v).toEqual([])
  })
})

describe('token-reserved-prefix', () => {
  it('warns when third-party code squats the kick/ prefix', () => {
    const v = tokenReservedPrefix.check({
      source: `const FOO = createToken<Foo>('kick/cool/Thing')`,
      file: 'mycorp/src/types.ts',
      firstParty: false,
    })
    expect(v).toHaveLength(1)
    expect(v[0].severity).toBe('warn')
    expect(v[0].suggestion).toContain('mycorp')
  })

  it('does not run on first-party code', () => {
    const v = tokenReservedPrefix.check({
      source: `const FOO = createToken<Foo>('kick/mailer/Service')`,
      file: 'packages/mailer/src/types.ts',
      firstParty: true,
    })
    expect(v).toEqual([])
  })
})
