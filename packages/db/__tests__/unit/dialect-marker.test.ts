import { describe, it, expect } from 'vitest'

import { markDialect, readDialectMark, KICK_DIALECT } from '../../src/dialect-marker'

describe('dialect marker', () => {
  it('stamps and reads a tag', () => {
    const d = markDialect({}, 'postgres')
    expect(readDialectMark(d)).toBe('postgres')
  })

  it('the mark is non-enumerable (does not leak into spreads/JSON)', () => {
    const d = markDialect({ createAdapter: () => ({}) }, 'sqlite')
    expect(Object.keys(d)).toEqual(['createAdapter'])
    expect(JSON.stringify(d)).toBe('{}')
    // Object spread copies ENUMERABLE symbol keys — assert the mark is
    // not carried (Object.keys/JSON.stringify ignore symbols regardless,
    // so they alone don't prove non-enumerability).
    const spread = { ...d }
    expect((spread as Record<symbol, unknown>)[KICK_DIALECT]).toBeUndefined()
    expect(Object.getOwnPropertyDescriptor(d, KICK_DIALECT)?.enumerable).toBe(false)
    // …but still readable via the symbol on the original.
    expect((d as Record<symbol, unknown>)[KICK_DIALECT]).toBe('sqlite')
  })

  it('returns undefined for an unmarked dialect (ctor-name fallback territory)', () => {
    expect(readDialectMark({})).toBeUndefined()
  })

  it('the factory-stamped tag survives on dialect instances', async () => {
    const { sqliteDialect } = await import('../../src/adapters/sqlite/dialect')
    // A fake better-sqlite3-shaped handle is enough; we only read the mark.
    const dialect = sqliteDialect({ database: {} as never })
    expect(readDialectMark(dialect)).toBe('sqlite')
  })
})
