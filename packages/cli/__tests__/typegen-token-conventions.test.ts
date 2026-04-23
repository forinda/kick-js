/**
 * Unit tests for the §22.4 token convention validator.
 */

import { describe, it, expect } from 'vitest'
import { validateTokenConventions } from '../src/typegen/token-conventions'
import type { DiscoveredToken } from '../src/typegen/scanner'

function token(name: string, variable: string | null = null): DiscoveredToken {
  return {
    name,
    variable,
    filePath: '/abs/file.ts',
    relativePath: 'src/file.ts',
  }
}

describe('validateTokenConventions — conformant tokens', () => {
  it('accepts the canonical kick/<area>/<key> shape', () => {
    const out = validateTokenConventions([
      token('kick/auth/User'),
      token('kick/prisma/Client'),
      token('kick/queue/Manager'),
    ])
    expect(out).toEqual([])
  })

  it('accepts third-party <scope>/<key> shape', () => {
    const out = validateTokenConventions([
      token('mycorp/Cache'),
      token('acme/AuditLog'),
      token('forinda/Foo'),
    ])
    expect(out).toEqual([])
  })

  it('accepts the optional /suffix segment', () => {
    const out = validateTokenConventions([
      token('mycorp/Cache/redis'),
      token('mycorp/Cache/memory'),
      token('kick/queue/Worker/email'),
    ])
    expect(out).toEqual([])
  })

  it('accepts the optional :instance suffix for .scoped() shards', () => {
    const out = validateTokenConventions([
      token('kick/prisma/Client:tenant'),
      token('mycorp/Worker:emails'),
      token('mycorp/Worker:emails:retry'),
    ])
    expect(out).toEqual([])
  })

  it('exempts legacy kickjs.* dotted form', () => {
    const out = validateTokenConventions([token('kickjs.ai.provider'), token('kickjs.mcp.tool')])
    expect(out).toEqual([])
  })
})

describe('validateTokenConventions — non-conformant tokens', () => {
  it('flags bare PascalCase tokens with a scope suggestion', () => {
    const out = validateTokenConventions([token('AuthUser', 'AUTH_USER')])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      token: 'AuthUser',
      variable: 'AUTH_USER',
      filePath: 'src/file.ts',
    })
    expect(out[0].suggestion).toContain("'mycorp/AuthUser'")
  })

  it('flags lowercase keys and suggests PascalCase', () => {
    const out = validateTokenConventions([token('auth/user')])
    expect(out).toHaveLength(1)
    expect(out[0].suggestion).toContain("'auth/User'")
  })

  it('flags dotted forms (non-legacy) and suggests slash form', () => {
    const out = validateTokenConventions([token('config.database.url')])
    expect(out).toHaveLength(1)
    expect(out[0].suggestion).toContain('dotted')
  })

  it('flags scope without a key', () => {
    const out = validateTokenConventions([token('mycorp/')])
    expect(out).toHaveLength(1)
  })

  it('flags uppercase scope', () => {
    const out = validateTokenConventions([token('Mycorp/Foo')])
    expect(out).toHaveLength(1)
  })

  it('flags entirely missing scope', () => {
    const out = validateTokenConventions([token('Foo')])
    expect(out).toHaveLength(1)
  })

  it('returns a warning per offender, not just the first', () => {
    const out = validateTokenConventions([
      token('Foo'),
      token('config.bar'),
      token('kick/auth/User'), // conformant
      token('lowercase'),
    ])
    expect(out).toHaveLength(3)
    expect(out.map((w) => w.token)).toEqual(['Foo', 'config.bar', 'lowercase'])
  })
})
