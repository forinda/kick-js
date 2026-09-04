import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'

import { introspectPg, renderSchemaSource, emitPg, diff, extractSnapshot } from '@forinda/kickjs-db'
import { table, serial, integer } from '@forinda/kickjs-db'
import type { ChangeSet } from '@forinda/kickjs-db'

let container: StartedPostgreSqlContainer
let client: pg.Client

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  client = new pg.Client({
    host: container.getHost(),
    port: container.getMappedPort(5432),
    user: container.getUsername(),
    password: container.getPassword(),
    database: container.getDatabase(),
  })
  await client.connect()
}, 90_000)

afterAll(async () => {
  await client?.end()
  await container?.stop()
})

beforeEach(async () => {
  // Drop everything between tests so each test starts from a clean schema.
  await client.query(`
    DO $$ DECLARE
      r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP TABLE IF EXISTS "' || r.tablename || '" CASCADE';
      END LOOP;
      -- Types outlive their tables, so a leftover enum would leak into the
      -- next test's snapshot.
      FOR r IN (
        SELECT t.typname FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typtype = 'e'
      ) LOOP
        EXECUTE 'DROP TYPE IF EXISTS "' || r.typname || '" CASCADE';
      END LOOP;
      -- Same for standalone sequences left behind by a dropped default.
      FOR r IN (SELECT sequencename FROM pg_sequences WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP SEQUENCE IF EXISTS "' || r.sequencename || '" CASCADE';
      END LOOP;
    END $$;
  `)
})

describe('long derived constraint names against a real database (#647)', () => {
  it('applies two foreign keys whose derived names both exceed 63 characters', async () => {
    // Under plain truncation both derive to the same 63-character name and
    // Postgres rejects the second with "constraint … already exists", stopping
    // the migration.
    const accounts = table('finance_vote_head_accounts', { id: serial().primaryKey() })
    const ledgers = table('finance_vote_head_account_reference_ledgers', {
      id: serial().primaryKey(),
      finance_vote_head_account_id: integer().references(() => accounts.id),
      finance_vote_head_account_ref_id: integer().references(() => accounts.id),
    })

    const snap = extractSnapshot({ accounts, ledgers }, 'postgres')
    await client.query(emitPg(diff({ version: 1, dialect: 'postgres', tables: {} }, snap)))

    const names = (
      await client.query<{ conname: string }>(
        `SELECT conname FROM pg_constraint
         WHERE contype = 'f'
           AND conrelid = 'finance_vote_head_account_reference_ledgers'::regclass
         ORDER BY conname`,
      )
    ).rows.map((r) => r.conname)

    expect(names).toHaveLength(2)
    expect(new Set(names).size).toBe(2)
    // Postgres stores what it was given; nothing was silently truncated.
    for (const n of names) expect(Buffer.byteLength(n)).toBeLessThanOrEqual(63)
  })
})

describe('enum types against a real database (#644)', () => {
  it('reads enum types and their value order into the snapshot', async () => {
    await client.query(`
      CREATE TYPE "enum_grading_systems_type" AS ENUM ('departmental', 'general');
      CREATE TYPE "enum_strands_term_order" AS ENUM ('1', '2', '3');
      CREATE TABLE "grading_systems" (
        "id" serial PRIMARY KEY,
        "type" "enum_grading_systems_type" NOT NULL DEFAULT 'departmental'
      );
    `)

    const snap = await introspectPg(client)

    expect(snap.enums).toEqual({
      enum_grading_systems_type: {
        name: 'enum_grading_systems_type',
        // Declaration order, not alphabetical — for an enum it is part of the
        // type: comparisons and ORDER BY follow it.
        values: ['departmental', 'general'],
      },
      enum_strands_term_order: {
        name: 'enum_strands_term_order',
        values: ['1', '2', '3'],
      },
    })

    // The column already carried the type name; it now has a declaration.
    expect(snap.tables.grading_systems.columns.type).toMatchObject({
      type: 'enum_grading_systems_type',
      default: 'departmental',
    })
  })

  it('omits the enums key entirely when the database declares none', async () => {
    await client.query(`CREATE TABLE "plain" ("id" serial PRIMARY KEY);`)
    expect((await introspectPg(client)).enums).toBeUndefined()
  })

  it('rebuilds the enum type from the rendered schema', async () => {
    // The end of the reported bug: introspect a database with an enum, render
    // it, and the generated schema must declare the type rather than reference
    // one that does not exist.
    await client.query(`
      CREATE TYPE "mood" AS ENUM ('sad', 'ok', 'happy');
      CREATE TABLE "people" (
        "id" serial PRIMARY KEY,
        "mood" "mood" NOT NULL DEFAULT 'ok'
      );
    `)

    const src = renderSchemaSource(await introspectPg(client))

    expect(src).toContain("export const mood = pgEnum('mood', 'sad', 'ok', 'happy')")
    expect(src).toContain('mood: mood().notNull().default("ok")')
    expect(src).not.toContain('TODO')
  })
})

describe('emitPg() defaults execute against a real database (#646)', () => {
  it('creates a table whose text defaults survive a round-trip', async () => {
    // Every one of these values reads as SQL by shape — a keyword, a number, a
    // boolean, a function call — and every one is text the author typed. The
    // emitter used to pass them through bare, so this CREATE TABLE was a
    // syntax error.
    const cs: ChangeSet = [
      {
        kind: 'createTable',
        table: {
          name: 'accounts',
          columns: {
            id: { name: 'id', type: 'serial', nullable: false, default: null, primaryKey: true },
            status: {
              name: 'status',
              type: 'varchar(20)',
              nullable: false,
              default: 'ACTIVE',
              primaryKey: false,
            },
            code: {
              name: 'code',
              type: 'text',
              nullable: false,
              default: '0800',
              primaryKey: false,
            },
            label: {
              name: 'label',
              type: 'text',
              nullable: false,
              default: 'true',
              primaryKey: false,
            },
            meta: {
              name: 'meta',
              type: 'jsonb',
              nullable: false,
              default: '{}',
              primaryKey: false,
            },
            seen_at: {
              name: 'seen_at',
              type: 'timestamptz',
              nullable: false,
              default: 'CURRENT_TIMESTAMP',
              primaryKey: false,
            },
          },
          indexes: [],
          foreignKeys: [],
          checks: [],
        },
      },
    ]

    await client.query(emitPg(cs))
    await client.query(`INSERT INTO "accounts" DEFAULT VALUES;`)

    const row = (await client.query(`SELECT * FROM "accounts"`)).rows[0]
    expect(row.status).toBe('ACTIVE')
    expect(row.code).toBe('0800')
    expect(row.label).toBe('true')
    expect(row.meta).toEqual({})
    expect(row.seen_at).toBeInstanceOf(Date)

    // And the defaults come back out unchanged, so the next diff is empty.
    const cols = (await introspectPg(client)).tables.accounts.columns
    expect(cols.status.default).toBe('ACTIVE')
    expect(cols.code.default).toBe('0800')
    expect(cols.seen_at.default).toBe('CURRENT_TIMESTAMP')
  })
})

describe('introspectPg()', () => {
  it('distinguishes a serial from a column defaulting off a standalone sequence (#649)', async () => {
    // Three columns with a `nextval(...)` default, only one of which is a
    // serial. Detection used to key on the default alone, so all three came
    // back as serial() — losing the sequence link and, for the nullable one,
    // silently making the column NOT NULL.
    await client.query(`
      CREATE SEQUENCE "shared_counter";
      CREATE TABLE "events" (
        "id" serial NOT NULL,
        "ticket_no" integer NOT NULL DEFAULT nextval('shared_counter'),
        "maybe_no" integer DEFAULT nextval('shared_counter'),
        PRIMARY KEY ("id")
      );
    `)

    const snap = await introspectPg(client)
    const cols = snap.tables.events.columns

    // An owned sequence + NOT NULL: a real serial, default collapsed.
    expect(cols.id).toMatchObject({ type: 'serial', nullable: false, default: null })

    // Standalone sequence: an ordinary integer that keeps its default.
    expect(cols.ticket_no).toMatchObject({ type: 'integer', nullable: false })
    expect(cols.ticket_no.default).toContain('nextval')

    // Same, and nullable — the case where serial() changed the column's shape.
    expect(cols.maybe_no).toMatchObject({ type: 'integer', nullable: true })
    expect(cols.maybe_no.default).toContain('nextval')
  })

  it('keeps a serial repointed at another sequence as a plain integer (#649)', async () => {
    // Ownership and use are separate facts. This column still OWNS
    // reassigned_id_seq — `pg_get_serial_sequence` reports it — but its default
    // now draws from a different sequence. Calling it serial would discard the
    // active default and point the column back at the one it no longer uses.
    await client.query(`
      CREATE TABLE "reassigned" ("id" serial NOT NULL);
      CREATE SEQUENCE "shared_ids";
      ALTER TABLE "reassigned" ALTER COLUMN "id" SET DEFAULT nextval('shared_ids');
    `)

    const col = (await introspectPg(client)).tables.reassigned.columns.id
    expect(col).toMatchObject({ type: 'integer', nullable: false })
    expect(col.default).toContain('shared_ids')
  })

  it('keeps a serial whose NOT NULL was dropped as a plain integer (#649)', async () => {
    // The sequence is still owned, so ownership alone would say "serial" — but
    // serial implies NOT NULL, and re-imposing it would reject the rows that
    // made someone drop it.
    await client.query(`
      CREATE TABLE "loose" ("id" serial);
      ALTER TABLE "loose" ALTER COLUMN "id" DROP NOT NULL;
    `)

    const col = (await introspectPg(client)).tables.loose.columns.id
    expect(col).toMatchObject({ type: 'integer', nullable: true })
    expect(col.default).toContain('nextval')
  })

  it('keeps the element type of an array column (#648)', async () => {
    await client.query(`
      CREATE TABLE "docs" (
        "id" serial PRIMARY KEY,
        "tags" text[] NOT NULL,
        "scores" integer[]
      );
    `)

    const cols = (await introspectPg(client)).tables.docs.columns
    expect(cols.tags).toMatchObject({ type: 'text[]', nullable: false })
    expect(cols.scores).toMatchObject({ type: 'integer[]', nullable: true })
  })

  it('extracts the canonical SchemaSnapshot for a 2-table schema with FK + indexes', async () => {
    await client.query(`
      CREATE TABLE "users" (
        "id" serial NOT NULL,
        "email" varchar(255) NOT NULL,
        "name" varchar(120),
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "is_active" boolean NOT NULL DEFAULT true,
        PRIMARY KEY ("id")
      );
      CREATE TABLE "posts" (
        "id" serial NOT NULL,
        "author_id" integer NOT NULL,
        "title" varchar(200) NOT NULL,
        "body" text NOT NULL,
        PRIMARY KEY ("id")
      );
      CREATE INDEX "users_email_idx" ON "users" ("email");
      CREATE UNIQUE INDEX "users_email_unique" ON "users" ("email");
      CREATE UNIQUE INDEX "posts_title_author_unique" ON "posts" ("title", "author_id");
      ALTER TABLE "posts" ADD CONSTRAINT "posts_author_fk"
        FOREIGN KEY ("author_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
    `)

    const snap = await introspectPg(client)

    expect(snap.version).toBe(1)
    expect(snap.dialect).toBe('postgres')
    expect(Object.keys(snap.tables).toSorted()).toEqual(['posts', 'users'])

    expect(snap.tables.users.columns.id).toEqual({
      name: 'id',
      type: 'serial',
      nullable: false,
      default: null,
      primaryKey: true,
    })
    expect(snap.tables.users.columns.email).toEqual({
      name: 'email',
      type: 'varchar(255)',
      nullable: false,
      default: null,
      primaryKey: false,
    })
    expect(snap.tables.users.columns.created_at).toMatchObject({
      type: 'timestamptz',
      default: 'CURRENT_TIMESTAMP',
    })
    expect(snap.tables.users.columns.is_active).toMatchObject({
      type: 'boolean',
      default: 'true',
    })

    // Indexes — the PK-backing index is excluded; user-defined ones are kept.
    expect(snap.tables.users.indexes.map((i) => i.name).toSorted()).toEqual([
      'users_email_idx',
      'users_email_unique',
    ])
    const unique = snap.tables.users.indexes.find((i) => i.name === 'users_email_unique')
    expect(unique?.unique).toBe(true)
    expect(unique?.columns).toEqual(['email'])

    // Multi-column unique on posts
    const multiUnique = snap.tables.posts.indexes.find(
      (i) => i.name === 'posts_title_author_unique',
    )
    expect(multiUnique?.unique).toBe(true)
    expect(multiUnique?.columns).toEqual(['title', 'author_id'])

    // FK
    expect(snap.tables.posts.foreignKeys).toEqual([
      {
        name: 'posts_author_fk',
        columns: ['author_id'],
        refTable: 'users',
        refColumns: ['id'],
        onDelete: 'cascade',
        onUpdate: 'no_action',
      },
    ])
  }, 60_000)

  it('skips kick_migrations + kick_migrations_lock tables', async () => {
    await client.query(`
      CREATE TABLE "kick_migrations" ("id" varchar(128) PRIMARY KEY);
      CREATE TABLE "kick_migrations_lock" ("id" smallint PRIMARY KEY);
      CREATE TABLE "users" ("id" serial PRIMARY KEY);
    `)
    const snap = await introspectPg(client)
    expect(snap.tables.kick_migrations).toBeUndefined()
    expect(snap.tables.kick_migrations_lock).toBeUndefined()
    expect(snap.tables.users).toBeDefined()
  }, 60_000)
})
