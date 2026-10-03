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

  it('rejects a garbage marker value (rogue Symbol.for stamp) → undefined', () => {
    const d = {}
    Object.defineProperty(d, KICK_DIALECT, { value: 'oracle', enumerable: false })
    // Not a supported tag → falls the caller back to ctor-name detection.
    expect(readDialectMark(d)).toBeUndefined()
  })

  it('the factory-stamped tag survives on dialect instances', async () => {
    const { sqliteDialect } = await import('../../src/adapters/sqlite/dialect')
    // A fake better-sqlite3-shaped handle is enough; we only read the mark.
    const dialect = sqliteDialect({ database: {} as never })
    expect(readDialectMark(dialect)).toBe('sqlite')
  })
})

describe('createDbClient dialect detection', () => {
  // A real dialect whose class and adapter name no known dialect.
  const unknownDialect = async () => {
    const { PostgresDialect } = await import('kysely')
    class CustomAdapter {}
    class CustomDialect extends PostgresDialect {
      createAdapter() {
        return new CustomAdapter() as never
      }
    }
    return new CustomDialect({ pool: {} as never })
  }

  it('recognises raw Kysely dialects by their adapter', async () => {
    const { MysqlDialect, PostgresDialect, SqliteDialect } = await import('kysely')
    const { createDbClient } = await import('../../src')
    const tagOf = (dialect: object) =>
      createDbClient({ schema: {}, dialect: dialect as never }).dialect
    expect(tagOf(new PostgresDialect({ pool: {} as never }))).toBe('postgres')
    expect(tagOf(new MysqlDialect({ pool: {} as never }))).toBe('mysql')
    expect(tagOf(new SqliteDialect({ database: {} as never }))).toBe('sqlite')
  })

  it('refuses to guess an unknown dialect, and takes dialectTag', async () => {
    const { createDbClient } = await import('../../src')
    const custom = await unknownDialect()
    expect(() => createDbClient({ schema: {}, dialect: custom as never })).toThrow(/dialectTag/)
    expect(
      createDbClient({ schema: {}, dialect: custom as never, dialectTag: 'postgres' }).dialect,
    ).toBe('postgres')
    expect(() =>
      createDbClient({
        schema: {},
        dialect: custom as never,
        dialectTag: 'oracle' as never,
      }),
    ).toThrow(/dialectTag must be/)
  })
})
