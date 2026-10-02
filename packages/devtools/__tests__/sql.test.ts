import { describe, expect, it } from 'vitest'
import { normalizeSql } from '../spa/src/lib/sql'

describe('normalizeSql', () => {
  it('folds values so the same statement groups together', () => {
    const a = normalizeSql("select * from notes where id = $1 and title = 'a''b'")
    const b = normalizeSql('select *  from notes\n where id = $7 and title = ?')
    expect(a).toBe('select * from notes where id = ? and title = ?')
    expect(b).toBe(a)
  })

  it('collapses IN lists and numbers, keeps identifiers with digits', () => {
    expect(normalizeSql('select v2 from t1 where id in (1, 2, 3) limit 10')).toBe(
      'select v2 from t1 where id in (?) limit ?',
    )
  })
})
