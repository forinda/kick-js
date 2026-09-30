/**
 * PROOF OF CONCEPT — one blog schema (enum, users, self-referencing
 * categories, posts with FKs and an index, and a users ↔ posts cycle)
 * written in each form, with the fixes applied and no annotations anywhere
 * (fixtures/table-forms/*). `kick db generate` snapshots a module's exports,
 * so a form is interchangeable when its module snapshots like the object one.
 */
import { describe, expect, it } from 'vitest'

import { extractSnapshot } from '../../src/index'
import * as O from './fixtures/table-forms/o-object'
import * as B from './fixtures/table-forms/b-fields'
import * as C from './fixtures/table-forms/c-base-class'
import * as D from './fixtures/table-forms/d-fluent'

const snap = (mod: Record<string, unknown>) => extractSnapshot(mod, 'postgres')
const expected = snap(O)

describe('the same schema in every form', () => {
  it('the object form has what the fixture promises', () => {
    expect(Object.keys(expected.tables).toSorted()).toEqual(['categories', 'posts', 'users'])
    expect(expected.enums).toHaveProperty('post_status')
    const fks = (t: string) =>
      expected.tables[t]!.foreignKeys.map(
        (f) => `${f.columns.join()}→${f.refTable}.${f.refColumns.join()}`,
      )
    expect(fks('categories')).toEqual(['parentId→categories.id']) // self-reference
    expect(fks('users')).toEqual(['featuredPostId→posts.id']) // cycle, via link()
    expect(fks('posts').toSorted()).toEqual(['authorId→users.id', 'categoryId→categories.id'])
    expect(expected.tables.posts!.indexes.map((i) => i.name)).toEqual(['posts_author'])
  })

  it.each([
    ['B builder fields', B],
    ['C TableBase (classes exported)', C],
    ['D defineTable', D],
  ])('%s snapshots exactly like the object form', (_name, mod) => {
    expect(snap(mod as Record<string, unknown>)).toEqual(expected)
  })

  it('C: rows are instances with methods', () => {
    const ada = C.User.from({
      id: 'x',
      email: 'ada@example.com',
      name: null,
      featuredPostId: null,
      createdAt: new Date(),
    })
    expect(ada.domain).toBe('example.com')
  })
})
