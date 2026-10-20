import { describe, it, expect, vi } from 'vitest'
import { checkDrift, MigrationDriftError } from '@forinda/kickjs-db'
import type { SchemaSnapshot } from '@forinda/kickjs-db'

const empty: SchemaSnapshot = { version: 1, dialect: 'postgres', tables: {} }

const withTable = (name: string): SchemaSnapshot => ({
  version: 1,
  dialect: 'postgres',
  tables: {
    [name]: {
      name,
      columns: {
        id: { name: 'id', type: 'integer', nullable: false, default: null, primaryKey: true },
      },
      indexes: [],
      foreignKeys: [],
      checks: [],
    },
  },
})

describe('checkDrift()', () => {
  it('passes when live matches expected', async () => {
    await expect(checkDrift(empty, empty, 'error')).resolves.toBeUndefined()
  })

  it('throws MigrationDriftError when live has an extra table', async () => {
    const live = withTable('manual_table')
    try {
      await checkDrift(live, empty, 'error')
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(MigrationDriftError)
      expect((err as MigrationDriftError).diff.added).toContain('manual_table')
    }
  })

  it('"warn" logs without throwing', async () => {
    const warn = vi.fn()
    const live = withTable('manual_table')
    await checkDrift(live, empty, 'warn', { warn })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toMatch(/Schema drift detected/)
  })

  it('"ignore" is a complete no-op even on drift', async () => {
    const live = withTable('manual_table')
    const warn = vi.fn()
    await expect(checkDrift(live, empty, 'ignore', { warn })).resolves.toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
  })

  it('detects removed tables (snapshot has it, live missing)', async () => {
    const expected = withTable('users')
    try {
      await checkDrift(empty, expected, 'error')
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(MigrationDriftError)
      expect((err as MigrationDriftError).diff.removed).toContain('users')
    }
  })
})

describe('checkDrift — primary keys', () => {
  it('names the table whose key drifted, once', async () => {
    const t = (pk: 'a' | 'b'): SchemaSnapshot => ({
      version: 1,
      dialect: 'postgres',
      tables: {
        m: {
          name: 'm',
          columns: {
            a: {
              name: 'a',
              type: 'integer',
              nullable: false,
              default: null,
              primaryKey: pk === 'a',
            },
            b: {
              name: 'b',
              type: 'integer',
              nullable: false,
              default: null,
              primaryKey: pk === 'b',
            },
          },
          indexes: [],
          foreignKeys: [],
          checks: [],
        },
      },
    })
    const err = await checkDrift(t('a'), t('b'), 'error').catch((e) => e)
    expect(err).toBeInstanceOf(MigrationDriftError)
    expect((err as MigrationDriftError).diff.changed).toEqual(['m#primaryKey'])
  })
})

describe('checkDrift() on a Postgres .defaultSql()', () => {
  const docs = (column: Record<string, unknown>): SchemaSnapshot => ({
    version: 1,
    dialect: 'postgres',
    tables: {
      docs: {
        name: 'docs',
        columns: {
          v: { name: 'v', type: 'text', nullable: true, primaryKey: false, ...column } as never,
        },
        indexes: [],
        foreignKeys: [],
        checks: [],
      },
    },
  })
  // What introspection makes of column_default: `'gen_random_uuid()'::text`
  // (a literal) reads back as `gen_random_uuid()`.
  const liveLiteral = docs({
    default: 'gen_random_uuid()',
    defaultRaw: "'gen_random_uuid()'::text",
  })

  it('matches a cast literal', async () => {
    const expected = docs({ default: "'gen_random_uuid()'::text", defaultSql: true })
    await expect(checkDrift(liveLiteral, expected, 'error')).resolves.toBeUndefined()
  })

  it('tells a cast expression from the literal it would print as', async () => {
    const expected = docs({ default: 'gen_random_uuid()::text', defaultSql: true })
    await expect(checkDrift(liveLiteral, expected, 'error')).rejects.toBeInstanceOf(
      MigrationDriftError,
    )
  })

  it('tells a literal from the expression it reads back as', async () => {
    // A live `gen_random_uuid()::text` is reported as `(gen_random_uuid())::text`
    // and normalised to `(gen_random_uuid())` — the literal below, unquoted.
    const liveExpression = docs({
      default: '(gen_random_uuid())',
      defaultRaw: '(gen_random_uuid())::text',
    })
    const expected = docs({ default: "'(gen_random_uuid())'::text", defaultSql: true })
    await expect(checkDrift(liveExpression, expected, 'error')).rejects.toBeInstanceOf(
      MigrationDriftError,
    )
  })

  it('reads :: inside a quoted literal as text, not a cast', async () => {
    const live = docs({ default: 'left::right', defaultRaw: "'left::right'::text" })
    const expected = docs({ default: "'left::right'", defaultSql: true })
    await expect(checkDrift(live, expected, 'error')).resolves.toBeUndefined()
  })
})
