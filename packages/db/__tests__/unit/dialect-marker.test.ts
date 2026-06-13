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
    // …but still readable via the symbol.
    expect((d as Record<symbol, unknown>)[KICK_DIALECT]).toBe('sqlite')
  })

  it('returns undefined for an unmarked dialect (ctor-name fallback territory)', () => {
    expect(readDialectMark({})).toBeUndefined()
  })

  it('the factory-stamped tag survives — createDbClient detects it exactly', async () => {
    const { sqliteDialect } = await import('../../src/adapters/sqlite/dialect')
    // A fake better-sqlite3-shaped handle is enough; we only read the mark.
    const dialect = sqliteDialect({ database: {} as never })
    expect(readDialectMark(dialect)).toBe('sqlite')
  })
})
