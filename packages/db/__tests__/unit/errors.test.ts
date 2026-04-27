import { describe, it, expect } from 'vitest'
import {
  KickDbError,
  MigrationError,
  MigrationLockError,
  MigrationDriftError,
  MigrationHashError,
  UnreviewedMigrationError,
} from '@forinda/kickjs-db'

describe('error hierarchy', () => {
  it('every migration error inherits from MigrationError and KickDbError', () => {
    const errs: MigrationError[] = [
      new MigrationLockError('locked'),
      new MigrationDriftError('drift', { added: ['x'], removed: [], changed: [] }),
      new MigrationHashError('20260427_init', 'expected', 'actual'),
      new UnreviewedMigrationError('20260427_init'),
    ]
    for (const e of errs) {
      expect(e).toBeInstanceOf(MigrationError)
      expect(e).toBeInstanceOf(KickDbError)
      expect(e).toBeInstanceOf(Error)
      expect(typeof e.code).toBe('string')
    }
  })

  it('MigrationDriftError carries the diff payload', () => {
    const e = new MigrationDriftError('schema drifted', {
      added: ['users.foo'],
      removed: ['users.bar'],
      changed: [],
    })
    expect(e.diff.added).toEqual(['users.foo'])
    expect(e.code).toBe('migration_drift')
  })

  it('MigrationHashError carries id + expected + actual', () => {
    const e = new MigrationHashError('20260427_init', 'sha256:abc', 'sha256:def')
    expect(e.id).toBe('20260427_init')
    expect(e.expected).toBe('sha256:abc')
    expect(e.actual).toBe('sha256:def')
  })

  it('UnreviewedMigrationError carries id', () => {
    const e = new UnreviewedMigrationError('20260427_init')
    expect(e.id).toBe('20260427_init')
    expect(e.code).toBe('migration_unreviewed')
  })

  it('KickDbError has the right name on subclasses', () => {
    expect(new MigrationLockError('x').name).toBe('MigrationLockError')
    expect(new UnreviewedMigrationError('y').name).toBe('UnreviewedMigrationError')
  })
})
