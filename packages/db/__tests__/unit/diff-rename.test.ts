import { describe, it, expect } from 'vitest'
import { diff } from '@forinda/kickjs-db'
import type { SchemaSnapshot, ColumnSnapshot } from '@forinda/kickjs-db'

const col = (name: string, overrides: Partial<ColumnSnapshot> = {}): ColumnSnapshot => ({
  name,
  type: 'varchar(255)',
  nullable: false,
  default: null,
  primaryKey: false,
  ...overrides,
})

const wrap = (cols: ColumnSnapshot[]): SchemaSnapshot => ({
  version: 1,
  dialect: 'postgres',
  tables: {
    t: {
      name: 't',
      columns: Object.fromEntries(cols.map((c) => [c.name, c])),
      indexes: [],
      foreignKeys: [],
      checks: [],
    },
  },
})

describe('diff() — rename heuristic', () => {
  it('detects rename when one drop + one add with identical attrs', () => {
    const changes = diff(wrap([col('emailAddr')]), wrap([col('email')]))
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({
      kind: 'renameColumn',
      table: 't',
      from: 'emailAddr',
      to: 'email',
    })
  })

  it('falls back to drop+add when types differ', () => {
    const changes = diff(
      wrap([col('a', { type: 'varchar(50)' })]),
      wrap([col('b', { type: 'text' })]),
    )
    expect(changes.map((c) => c.kind).toSorted()).toEqual(['addColumn', 'dropColumn'])
  })

  it('does not rename when ambiguous (multiple matching adds/drops)', () => {
    const changes = diff(wrap([col('a'), col('b')]), wrap([col('c'), col('d')]))
    expect(changes.filter((c) => c.kind === 'renameColumn')).toHaveLength(0)
    expect(changes).toHaveLength(4)
  })
})
