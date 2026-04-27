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
