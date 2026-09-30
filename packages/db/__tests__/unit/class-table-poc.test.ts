/**
 * PROOF OF CONCEPT — class forms of a kick/db table (src/class-table.ts).
 *
 * What each has to show: the class is only another way to write
 * `table(...)` / `pgSchema(...).table(...)`. Its snapshot, and so its
 * migrations, match the object form exactly; the request schemas build from
 * it; and (variant B) a real database round-trips it with a typed client.
 *
 * A — `@Table('x') class { @Column(builder) prop!: T }`
 * B — `class { static tableName = 'x'; prop = builder }` + `tableFromClass`
 */
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import {
  createDbClient,
  diff,
  emitSqlite,
  extractSnapshot,
  integer,
  serial,
  table,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from '../../src/index'
import { sqliteDialect } from '../../src/sqlite'
import { pgSchema } from '../../src/pg'
import {
  Column,
  Rule,
  Table,
  TableBase,
  defineTable,
  rulesOf,
  tableFromClass,
  tableOf,
  type ClassRefs,
} from '../../src/class-table'
import { insertSchema } from '../../src/schema'

// The object form both variants must reproduce.
const authorsObj = table('authors', {
  id: serial().primaryKey(),
  email: varchar(120).notNull().unique(),
  bio: text(),
})
const booksObj = table('books', {
  id: serial().primaryKey(),
  title: varchar(200).notNull(),
  authorId: integer()
    .notNull()
    .references(() => authorsObj.id, { onDelete: 'cascade' }),
  createdAt: timestamp().notNull().defaultNow(),
})
const objectSnapshot = () => extractSnapshot({ authors: authorsObj, books: booksObj }, 'sqlite')
const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {}, enums: {} }

// ── A: decorators ───────────────────────────────────────────────────────

@Table('authors')
class AuthorA {
  @Column(serial().primaryKey()) id!: number
  @Column(varchar(120).notNull().unique(), { format: 'email' }) email!: string
  @Column(text()) bio!: string | null
}

@Table('books')
class BookA {
  @Column(serial().primaryKey()) id!: number
  @Column(varchar(200).notNull(), { minLength: 2 }) title!: string
  @Column(
    integer()
      .notNull()
      .references(() => tableOf(AuthorA).id, { onDelete: 'cascade' }),
  )
  authorId!: number
  @Column(timestamp().notNull().defaultNow()) createdAt!: Date
}

describe('A: @Table / @Column', () => {
  it('snapshots exactly like the object form', () => {
    const snap = extractSnapshot({ authors: tableOf(AuthorA), books: tableOf(BookA) }, 'sqlite')
    expect(snap).toEqual(objectSnapshot())
    expect(diff(objectSnapshot(), snap)).toEqual([])
  })

  it('builds the table once, and carries @Column rules into the request schema', () => {
    expect(tableOf(AuthorA)).toBe(tableOf(AuthorA))
    const createAuthor = insertSchema(tableOf(AuthorA), { columns: rulesOf(AuthorA) })
    expect(createAuthor.safeParse({ email: 'not-an-email' }).success).toBe(false)
    expect(createAuthor.safeParse({ email: 'ada@example.com' }).success).toBe(true)
  })

  it('names what is missing', () => {
    class NoTable {
      @Column(text()) x!: string | null
    }
    expect(() => tableOf(NoTable)).toThrow('has no @Table')
    @Table('empty')
    class NoColumns {}
    expect(() => tableOf(NoColumns)).toThrow('declares no @Column')
  })
})

// ── B: builders as fields ───────────────────────────────────────────────

class Authors {
  static readonly tableName = 'authors'
  id = serial().primaryKey()
  @Rule({ format: 'email' }) email = varchar(120).notNull().unique()
  bio = text()
}
const authors = tableFromClass(Authors)

class Books {
  static readonly tableName = 'books'
  id = serial().primaryKey()
  @Rule({ minLength: 2 }) title = varchar(200).notNull()
  authorId = integer()
    .notNull()
    .references(() => authors.id, { onDelete: 'cascade' })
  createdAt = timestamp().notNull().defaultNow()
}
const books = tableFromClass(Books)

describe('B: builder fields + tableFromClass', () => {
  it('snapshots exactly like the object form', () => {
    const snap = extractSnapshot({ authors, books }, 'sqlite')
    expect(snap).toEqual(objectSnapshot())
  })

  it('round-trips through a real database with a typed client', async () => {
    const database = new Database(':memory:')
    const schema = { authors, books }
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

  it('carries @Rule into the request schema', () => {
    const createBook = insertSchema(books, { columns: rulesOf(Books) })
    const bad = createBook.safeParse({ title: 'A', authorId: 1 })
    expect(bad.success).toBe(false)
    if (!bad.success) expect(bad.issues[0]!.path).toEqual(['title'])
  })

  it('reads only builder fields', () => {
    class Mixed {
      static readonly tableName = 'mixed'
      id = uuid().primaryKey()
      note = 'not a column'
    }
    expect(Object.keys(tableFromClass(Mixed).__columns)).toEqual(['id'])
    class None {
      static readonly tableName = 'none'
    }
    expect(() => tableFromClass(None)).toThrow('has no column fields')
  })
})

// ── Postgres schemas (namespaces), in both forms ────────────────────────

describe('a table in a Postgres schema', () => {
  const invoicesObj = pgSchema('billing').table('invoices', {
    id: uuid().primaryKey().defaultRandom(),
    total: integer().notNull(),
  })

  it('A: @Table(name, { schema }) matches pgSchema(schema).table(...)', () => {
    @Table('invoices', { schema: 'billing' })
    class Invoice {
      @Column(uuid().primaryKey().defaultRandom()) id!: string
      @Column(integer().notNull()) total!: number
    }
    expect(tableOf(Invoice).__schema).toBe('billing')
    expect(extractSnapshot({ invoices: tableOf(Invoice) }, 'postgres')).toEqual(
      extractSnapshot({ invoices: invoicesObj }, 'postgres'),
    )
  })

  it('B: static schema matches pgSchema(schema).table(...)', () => {
    class Invoices {
      static readonly tableName = 'invoices'
      static readonly schema = 'billing'
      id = uuid().primaryKey().defaultRandom()
      total = integer().notNull()
    }
    const snap = extractSnapshot({ invoices: tableFromClass(Invoices) }, 'postgres')
    expect(Object.keys(snap.tables)).toEqual(['billing.invoices'])
    expect(snap).toEqual(extractSnapshot({ invoices: invoicesObj }, 'postgres'))
  })
})

// ── C: base-class factory, D: fluent builder ────────────────────────────

class Author extends TableBase(
  'authors',
  {
    id: serial().primaryKey(),
    email: varchar(120).notNull().unique(),
    bio: text(),
  },
  { rules: { email: { format: 'email' } } },
) {
  get domain() {
    return this.email.split('@')[1]
  }
}

const authorsD = defineTable('authors')
  .column('id', serial().primaryKey())
  .column('email', varchar(120).notNull().unique(), { format: 'email' })
  .column('bio', text())
  .build()

describe('C: TableBase', () => {
  it('snapshots like the object form, and rows become instances with methods', () => {
    expect(extractSnapshot({ authors: Author.table }, 'sqlite')).toEqual(
      extractSnapshot({ authors: authorsObj }, 'sqlite'),
    )
    const ada = Author.from({ id: 1, email: 'ada@example.com', bio: null })
    expect(ada).toBeInstanceOf(Author)
    expect(ada.domain).toBe('example.com')
  })

  it('carries its rules into the request schema', () => {
    const create = insertSchema(Author.table, { columns: Author.rules })
    expect(create.safeParse({ email: 'nope' }).success).toBe(false)
  })

  it('takes indexes over its columns', () => {
    class Tagged extends TableBase(
      'tagged',
      { id: serial().primaryKey(), slug: varchar(40).notNull() },
      { indexes: (t) => ({ bySlug: unique('tagged_slug').on(t.slug) }) },
    ) {}
    expect(Tagged.table.__indexes).toEqual([
      { name: 'tagged_slug', columns: ['slug'], unique: true },
    ])
  })
})

describe('D: defineTable', () => {
  it('snapshots like the object form, and carries its rules', () => {
    expect(extractSnapshot({ authors: authorsD }, 'sqlite')).toEqual(
      extractSnapshot({ authors: authorsObj }, 'sqlite'),
    )
    const rules = defineTable('authors')
      .column('email', varchar(120).notNull(), { format: 'email' })
      .rules()
    expect(rules).toEqual({ email: { format: 'email' } })
  })

  it('takes indexes and a Postgres schema', () => {
    const invoices = defineTable('invoices', { schema: 'billing' })
      .column('id', uuid().primaryKey())
      .column('ref', varchar(20).notNull())
      .index((t) => ({ byRef: unique('invoices_ref').on(t.ref) }))
      .build()
    expect(invoices.__schema).toBe('billing')
    expect(invoices.__indexes).toEqual([{ name: 'invoices_ref', columns: ['ref'], unique: true }])
  })
})

describe('B: static indexes', () => {
  it('passes them to the table', () => {
    class Slugs {
      static readonly tableName = 'slugs'
      static readonly indexes = (t: ClassRefs<typeof Slugs>) => ({
        bySlug: unique('slugs_slug').on(t.slug),
      })
      id = serial().primaryKey()
      slug = varchar(40).notNull()
    }
    expect(tableFromClass(Slugs).__indexes).toEqual([
      { name: 'slugs_slug', columns: ['slug'], unique: true },
    ])
  })
})
