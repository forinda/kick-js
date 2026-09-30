/**
 * Table forms — builder fields (`tableFromClass`), base class (`TableBase`)
 * and fluent (`defineTable`) — plus `selfRef`, `fk` and `link`.
 *
 * Every form must produce the table `table()` would: same snapshot (so the
 * same migrations), a working typed client, the same request schemas. And
 * the rules a form declares travel with the table into `insertSchema`.
 */
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import {
  Rule,
  TableBase,
  createDbClient,
  defineTable,
  diff,
  emitSqlite,
  extractSnapshot,
  fk,
  index,
  integer,
  link,
  selfRef,
  serial,
  table,
  tableFromClass,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
  type ClassRefs,
  type ColumnRef,
} from '../../src/index'
import { pgSchema } from '../../src/pg'
import { sqliteDialect } from '../../src/sqlite'
import { insertSchema } from '../../src/schema'

const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {}, enums: {} }

// The object form every other form must reproduce.
const authorsO = table('authors', {
  id: serial().primaryKey(),
  email: varchar(120).notNull().unique(),
  bio: text(),
})
const booksO = table('books', {
  id: serial().primaryKey(),
  title: varchar(200).notNull(),
  authorId: integer()
    .notNull()
    .references(() => authorsO.id, { onDelete: 'cascade' }),
  createdAt: timestamp().notNull().defaultNow(),
})
const expected = () => extractSnapshot({ authorsO, booksO }, 'sqlite')

class Authors {
  static readonly tableName = 'authors'
  id = serial().primaryKey()
  @Rule({ format: 'email' }) email = varchar(120).notNull().unique()
  bio = text()
}
const authorsB = tableFromClass(Authors)
class Books {
  static readonly tableName = 'books'
  id = serial().primaryKey()
  @Rule({ minLength: 2 }) title = varchar(200).notNull()
  authorId = integer()
    .notNull()
    .references(() => authorsB.id, { onDelete: 'cascade' })
  createdAt = timestamp().notNull().defaultNow()
}
const booksB = tableFromClass(Books)

class Author extends TableBase(
  'authors',
  { id: serial().primaryKey(), email: varchar(120).notNull().unique(), bio: text() },
  { rules: { email: { format: 'email' } } },
) {
  get domain() {
    return this.email.split('@')[1]
  }
}
class Book extends TableBase(
  'books',
  {
    id: serial().primaryKey(),
    title: varchar(200).notNull(),
    authorId: fk(integer().notNull(), () => Author.table.id, { onDelete: 'cascade' }),
    createdAt: timestamp().notNull().defaultNow(),
  },
  { rules: { title: { minLength: 2 } } },
) {}

const authorsD = defineTable('authors')
  .column('id', serial().primaryKey())
  .column('email', varchar(120).notNull().unique(), { format: 'email' })
  .column('bio', text())
  .build()
const booksD = defineTable('books')
  .column('id', serial().primaryKey())
  .column('title', varchar(200).notNull(), { minLength: 2 })
  .column(
    'authorId',
    fk(integer().notNull(), () => authorsD.id, { onDelete: 'cascade' }),
  )
  .column('createdAt', timestamp().notNull().defaultNow())
  .build()

const forms = [
  ['builder fields', { authors: authorsB, books: booksB }],
  ['base class', { Author, Book }],
  ['fluent', { authors: authorsD, books: booksD }],
] as const

describe.each(forms)('%s', (_form, schema) => {
  it('snapshots exactly like table() — the same migrations', () => {
    expect(extractSnapshot(schema, 'sqlite')).toEqual(expected())
  })

  it('round-trips through a real database', async () => {
    const database = new Database(':memory:')
    database.exec(emitSqlite(diff(empty as never, extractSnapshot(schema, 'sqlite'))))
    const db = createDbClient({ schema, dialect: sqliteDialect({ database }) })
    try {
      const author = await db
        .insertInto('authors')
        .values({ email: 'ada@example.com' })
        .returning(['id'])
        .executeTakeFirstOrThrow()
      await db.insertInto('books').values({ title: 'Notes', authorId: author.id }).execute()
      const rows = await db
        .selectFrom('books')
        .innerJoin('authors', 'authors.id', 'books.authorId')
        .select(['books.title', 'authors.email'])
        .execute()
      expect(rows).toEqual([{ title: 'Notes', email: 'ada@example.com' }])
    } finally {
      await db.destroy()
      database.close()
    }
  })
})

describe('rules travel with the table', () => {
  it.each([
    ['builder fields', authorsB, booksB],
    ['base class', Author.table, Book.table],
    ['fluent', authorsD, booksD],
  ])('%s: insertSchema applies them with no options', (_form, authors, books) => {
    const createAuthor = insertSchema(authors)
    expect(createAuthor.safeParse({ email: 'nope' }).success).toBe(false)
    expect(createAuthor.safeParse({ email: 'ada@example.com' }).success).toBe(true)
    const createBook = insertSchema(books)
    const bad = createBook.safeParse({ title: 'A', authorId: 1 })
    expect(bad.success).toBe(false)
    if (!bad.success) expect(bad.issues[0]!.path).toEqual(['title'])
    expect(
      (createAuthor.toJsonSchema() as { properties: Record<string, unknown> }).properties.email,
    ).toEqual({ type: 'string', maxLength: 120, format: 'email' })
  })

  it('the columns option overrides a declared rule', () => {
    const lenient = insertSchema(authorsD, { columns: { email: { minLength: 1 } } })
    expect(lenient.safeParse({ email: 'nope' }).success).toBe(true)
  })

  it('rules are not a column: the table keys stay its column refs', () => {
    expect(Object.keys(authorsD).filter((k) => !k.startsWith('__'))).toEqual(['id', 'email', 'bio'])
  })
})

describe('base class', () => {
  it('turns a row into an instance with its methods', () => {
    const ada = Author.from({ id: 1, email: 'ada@example.com', bio: null })
    expect(ada).toBeInstanceOf(Author)
    expect(ada.domain).toBe('example.com')
  })

  it('is found when the class itself is exported', () => {
    expect(Object.keys(extractSnapshot({ Author }, 'sqlite').tables)).toEqual(['authors'])
  })
})

describe('builder fields', () => {
  it('ignores non-builder fields, builds once, and needs a column', () => {
    class Mixed {
      static readonly tableName = 'mixed'
      id = uuid().primaryKey()
      note = 'not a column'
    }
    expect(Object.keys(tableFromClass(Mixed).__columns)).toEqual(['id'])
    expect(tableFromClass(Mixed)).toBe(tableFromClass(Mixed))
    class None {
      static readonly tableName = 'none'
    }
    expect(() => tableFromClass(None)).toThrow('has no column fields')
  })
})

describe('indexes', () => {
  const byslug = [{ name: 'x_slug', columns: ['slug'], unique: true }]

  it('builder fields: static indexes', () => {
    class X {
      static readonly tableName = 'x'
      static readonly indexes = (t: ClassRefs<typeof X>) => ({ s: unique('x_slug').on(t.slug) })
      slug = varchar(40).notNull()
    }
    expect(tableFromClass(X).__indexes).toEqual(byslug)
  })

  it('base class: the indexes option', () => {
    class X extends TableBase(
      'x',
      { slug: varchar(40).notNull() },
      { indexes: (t) => ({ s: unique('x_slug').on(t.slug) }) },
    ) {}
    expect(X.table.__indexes).toEqual(byslug)
  })

  it('fluent: repeated .index() calls add up', () => {
    const x = defineTable('x')
      .column('slug', varchar(40).notNull())
      .column('title', text())
      .index((t) => ({ s: unique('x_slug').on(t.slug) }))
      .index((t) => ({ t: index('x_title').on(t.title) }))
      .build()
    expect(x.__indexes.map((i) => i.name)).toEqual(['x_slug', 'x_title'])
  })

  it('fluent: .index()', () => {
    const x = defineTable('x')
      .column('slug', varchar(40).notNull())
      .index((t) => ({ s: unique('x_slug').on(t.slug) }))
      .build()
    expect(x.__indexes).toEqual(byslug)
  })
})

describe('Postgres schemas', () => {
  const invoicesO = pgSchema('billing').table('invoices', {
    id: uuid().primaryKey().defaultRandom(),
    total: integer().notNull(),
  })
  const expectedPg = () => extractSnapshot({ invoicesO }, 'postgres')

  it('every form qualifies the table like pgSchema(...).table()', () => {
    class Invoices {
      static readonly tableName = 'invoices'
      static readonly schema = 'billing'
      id = uuid().primaryKey().defaultRandom()
      total = integer().notNull()
    }
    class Invoice extends TableBase(
      'invoices',
      { id: uuid().primaryKey().defaultRandom(), total: integer().notNull() },
      { schema: 'billing' },
    ) {}
    const invoicesD = defineTable('invoices', { schema: 'billing' })
      .column('id', uuid().primaryKey().defaultRandom())
      .column('total', integer().notNull())
      .build()
    for (const t of [tableFromClass(Invoices), Invoice.table, invoicesD]) {
      expect(extractSnapshot({ t }, 'postgres')).toEqual(expectedPg())
    }
  })
})

describe('self-references, cycles and typed foreign keys', () => {
  const categoriesO = table('categories', {
    id: uuid().primaryKey(),
    // The object form as written without selfRef: it needs the annotation.
    parentId: uuid().references((): ColumnRef => categoriesO.id),
  })
  const expectedTree = () => extractSnapshot({ categoriesO }, 'postgres')

  it('selfRef in table(), a TableBase and defineTable', () => {
    const viaTable = table('categories', {
      id: uuid().primaryKey(),
      parentId: uuid().references(selfRef('id')),
    })
    class Category extends TableBase('categories', {
      id: uuid().primaryKey(),
      parentId: uuid().references(selfRef('id')),
    }) {}
    const viaCallback = defineTable('categories')
      .column('id', uuid().primaryKey())
      .column('parentId', (t) => fk(uuid(), () => t.id))
      .build()
    for (const t of [viaTable, Category.table, viaCallback]) {
      expect(extractSnapshot({ t }, 'postgres')).toEqual(expectedTree())
    }
  })

  it('a selfRef builder shared by two tables points each at itself', () => {
    const parent = uuid().references(selfRef('id'))
    const a = table('a', { id: uuid().primaryKey(), parentId: parent })
    const b = pgSchema('org').table('b', { id: uuid().primaryKey(), parentId: parent })
    const target = (t: object, key: string) =>
      extractSnapshot({ t }, 'postgres').tables[key]!.foreignKeys[0]!.refTable
    expect(target(a, 'a')).toBe('a')
    expect(target(b, 'org.b')).toBe('org.b')
  })

  it('a table that fails to build leaves its selfRef builder unbound', () => {
    const parent = uuid().references(selfRef('id'))
    expect(() =>
      table('broken', { id: uuid().primaryKey(), parentId: parent }, () => {
        throw new Error('bad index')
      }),
    ).toThrow('bad index')
    const ok = table('ok', { id: uuid().primaryKey(), parentId: parent })
    expect(extractSnapshot({ ok }, 'postgres').tables.ok!.foreignKeys[0]!.refTable).toBe('ok')
  })

  it('selfRef rejects an inherited name, not only a missing one', () => {
    expect(() => table('n', { id: uuid(), p: uuid().references(selfRef('constructor')) })).toThrow(
      "table 'n' has no column 'constructor'",
    )
  })

  it('selfRef names a missing column', () => {
    expect(() => table('c', { id: uuid(), parentId: uuid().references(selfRef('nope')) })).toThrow(
      "selfRef('nope'): table 'c' has no column 'nope'",
    )
  })

  it('link() adds a cycle after both tables exist', () => {
    const users = table('users', { id: uuid().primaryKey(), featuredPostId: integer() })
    const posts = table('posts', {
      id: serial().primaryKey(),
      authorId: fk(uuid(), () => users.id),
    })
    link(users.featuredPostId, () => posts.id, { onDelete: 'set_null' })
    const snap = extractSnapshot({ users, posts }, 'postgres')
    expect(snap.tables.users!.foreignKeys).toMatchObject([
      { columns: ['featuredPostId'], refTable: 'posts', refColumns: ['id'], onDelete: 'set_null' },
    ])
  })

  it('fk() records the same foreign key as .references()', () => {
    const users = table('users', { id: uuid().primaryKey() })
    const viaFk = table('posts', { authorId: fk(uuid(), () => users.id, { onDelete: 'cascade' }) })
    const viaRef = table('posts', {
      authorId: uuid().references(() => users.id, { onDelete: 'cascade' }),
    })
    expect(extractSnapshot({ users, viaFk }, 'postgres')).toEqual(
      extractSnapshot({ users, viaRef }, 'postgres'),
    )
  })
})
