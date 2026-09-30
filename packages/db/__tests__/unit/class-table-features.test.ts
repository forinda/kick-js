/**
 * PROOF OF CONCEPT — the table forms against the rest of what a kick/db
 * schema does: enums, self-references, circular foreign keys, relations,
 * and discovery by `kick db generate` (which snapshots a module's exports).
 *
 *   O  table()   A  @Table/@Column   B  builder fields   C  TableBase   D  defineTable
 */
import { describe, expect, it } from 'vitest'

import { extractSnapshot, relations, serial, table, text, uuid, varchar } from '../../src/index'
import { pgEnum } from '../../src/dsl/columns/pg'
import type { ColumnRef } from '../../src/dsl/table'
import {
  Column,
  Table,
  TableBase,
  defineTable,
  fk,
  selfRef,
  tableFromClass,
  tableOf,
} from '../../src/class-table'

const status = pgEnum('post_status', 'draft', 'published')
const snap = (schema: Record<string, unknown>) => extractSnapshot(schema, 'postgres')

// ── Enums ───────────────────────────────────────────────────────────────

describe('enums', () => {
  const O = table('posts', { id: serial().primaryKey(), status: status().notNull() })

  it('every form carries a pgEnum column into the snapshot the same way', () => {
    @Table('posts')
    class PostA {
      @Column(serial().primaryKey()) id!: number
      @Column(status().notNull()) status!: 'draft' | 'published'
    }
    class PostsB {
      static readonly tableName = 'posts'
      id = serial().primaryKey()
      status = status().notNull()
    }
    class PostC extends TableBase('posts', {
      id: serial().primaryKey(),
      status: status().notNull(),
    }) {}
    const D = defineTable('posts')
      .column('id', serial().primaryKey())
      .column('status', status().notNull())
      .build()

    const expected = snap({ posts: O, status })
    expect(snap({ posts: tableOf(PostA), status })).toEqual(expected)
    expect(snap({ posts: tableFromClass(PostsB), status })).toEqual(expected)
    expect(snap({ posts: PostC.table, status })).toEqual(expected)
    expect(snap({ posts: D, status })).toEqual(expected)
    expect(expected.enums).toHaveProperty('post_status')
  })
})

// ── Self-referencing table ──────────────────────────────────────────────

describe('self-reference (a category tree)', () => {
  const O = table('categories', {
    id: uuid().primaryKey(),
    parentId: uuid().references((): ColumnRef => O.id),
  })
  const expected = () => snap({ categories: O })

  it('B: a field thunk to the table const', () => {
    class CategoriesB {
      static readonly tableName = 'categories'
      id = uuid().primaryKey()
      parentId = uuid().references((): ColumnRef => categoriesB.id)
    }
    const categoriesB = tableFromClass(CategoriesB)
    expect(snap({ categories: categoriesB })).toEqual(expected())
  })

  it('C: a thunk to the class being defined', () => {
    class Category extends TableBase('categories', {
      id: uuid().primaryKey(),
      parentId: uuid().references((): ColumnRef => Category.table.id),
    }) {}
    expect(snap({ categories: Category.table })).toEqual(expected())
  })

  it('D: a thunk to the built const', () => {
    const categoriesD = defineTable('categories')
      .column('id', uuid().primaryKey())
      .column(
        'parentId',
        uuid().references((): ColumnRef => categoriesD.id),
      )
      .build()
    expect(snap({ categories: categoriesD })).toEqual(expected())
  })
})

describe('self-reference without the (): ColumnRef annotation', () => {
  const O = table('categories', {
    id: uuid().primaryKey(),
    parentId: uuid().references((): ColumnRef => O.id),
  })
  const expected = () => snap({ categories: O })

  it('A: the decorator argument can name the class', () => {
    @Table('categories')
    class CategoryA {
      @Column(uuid().primaryKey()) id!: string
      @Column(uuid().references(() => tableOf(CategoryA).id)) parentId!: string | null
    }
    expect(snap({ categories: tableOf(CategoryA) })).toEqual(expected())
  })

  it('B: a plain thunk compiles — the class body breaks the inference cycle', () => {
    class CategoriesB {
      static readonly tableName = 'categories'
      id = uuid().primaryKey()
      parentId = uuid().references(() => categoriesB.id)
    }
    const categoriesB = tableFromClass(CategoriesB)
    expect(snap({ categories: categoriesB })).toEqual(expected())
  })

  it('C: selfRef("id")', () => {
    class Category extends TableBase('categories', {
      id: uuid().primaryKey(),
      parentId: uuid().references(selfRef('id')),
    }) {}
    expect(snap({ categories: Category.table })).toEqual(expected())
  })

  it('D: a column callback over the columns declared so far', () => {
    const categoriesD = defineTable('categories')
      .column('id', uuid().primaryKey())
      .column('parentId', (t) => fk(uuid(), () => t.id))
      .build()
    expect(snap({ categories: categoriesD })).toEqual(expected())
  })

  it('selfRef names a missing column at build time', () => {
    expect(() =>
      defineTable('c')
        .column('id', uuid())
        .column('parentId', uuid().references(selfRef('nope')))
        .build(),
    ).toThrow("selfRef('nope'): table 'c' has no column 'nope'")
  })
})

// ── Circular foreign keys between two tables ────────────────────────────

describe('circular foreign keys (author ↔ featured post)', () => {
  const expected = () => {
    const authors = table('authors', {
      id: serial().primaryKey(),
      featuredPostId: serial().references((): ColumnRef => posts.id),
    })
    const posts = table('posts', {
      id: serial().primaryKey(),
      authorId: serial().references(() => authors.id),
    })
    return snap({ authors, posts })
  }

  it('C: classes reference each other through thunks', () => {
    class Author extends TableBase('authors', {
      id: serial().primaryKey(),
      featuredPostId: serial().references((): ColumnRef => Post.table.id),
    }) {}
    class Post extends TableBase('posts', {
      id: serial().primaryKey(),
      authorId: serial().references(() => Author.table.id),
    }) {}
    expect(snap({ authors: Author.table, posts: Post.table })).toEqual(expected())
  })

  it('D: consts reference each other through thunks', () => {
    const authors = defineTable('authors')
      .column('id', serial().primaryKey())
      .column(
        'featuredPostId',
        serial().references((): ColumnRef => posts.id),
      )
      .build()
    const posts = defineTable('posts')
      .column('id', serial().primaryKey())
      .column(
        'authorId',
        serial().references(() => authors.id),
      )
      .build()
    expect(snap({ authors, posts })).toEqual(expected())
  })
})

// ── Typed foreign keys ──────────────────────────────────────────────────

describe('fk()', () => {
  it('records the same foreign key as .references()', () => {
    const users = defineTable('users').column('id', uuid().primaryKey()).build()
    const viaFk = defineTable('posts')
      .column('id', serial().primaryKey())
      .column(
        'authorId',
        fk(uuid().notNull(), () => users.id, { onDelete: 'cascade' }),
      )
      .build()
    const viaReferences = table('posts', {
      id: serial().primaryKey(),
      authorId: uuid()
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
    })
    expect(snap({ users, posts: viaFk })).toEqual(snap({ users, posts: viaReferences }))
  })
})

// ── Relations ───────────────────────────────────────────────────────────

describe('relations()', () => {
  it("takes each form's table and keeps its name", () => {
    class User extends TableBase('users', { id: serial().primaryKey() }) {}
    const posts = defineTable('posts')
      .column('id', serial().primaryKey())
      .column(
        'authorId',
        fk(serial(), () => User.table.id),
      )
      .build()
    const userRelations = relations(User.table, (h) => ({ posts: h.many(posts) }))
    const postRelations = relations(posts, (h) => ({
      author: h.one(User.table, { fields: [posts.authorId], references: [User.table.id] }),
    }))
    expect(userRelations.__sourceTable).toBe('users')
    expect(postRelations.__relations.author.target).toBe(User.table)
  })
})

// ── Discovery by `kick db generate` ─────────────────────────────────────

describe('discovery (kick db generate snapshots the schema module exports)', () => {
  it('finds exported tables from O, A, B and D', () => {
    @Table('a')
    class A {
      @Column(serial()) id!: number
    }
    class B {
      static readonly tableName = 'b'
      id = serial()
    }
    const moduleExports = {
      o: table('o', { id: serial() }),
      a: tableOf(A),
      b: tableFromClass(B),
      d: defineTable('d').column('id', serial()).build(),
    }
    expect(Object.keys(snap(moduleExports).tables).toSorted()).toEqual(['a', 'b', 'd', 'o'])
  })

  it('C: an exported class is NOT found — export `X.table` too', () => {
    class User extends TableBase('users', { id: serial() }) {}
    expect(Object.keys(snap({ User }).tables)).toEqual([])
    expect(Object.keys(snap({ User, users: User.table }).tables)).toEqual(['users'])
  })

  it('A, B, C: the class name is not the table name', () => {
    // Nothing to assert at runtime — recorded here: snapshot keys come from the
    // declared name (`@Table('users')`, `tableName`, `TableBase('users')`), so
    // renaming the class never renames the table.
    expect(text().__state().type).toBe('text')
    expect(varchar(3).__state().type).toBe('varchar(3)')
  })
})
