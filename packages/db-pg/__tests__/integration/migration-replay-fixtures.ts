import type { SchemaSnapshot } from '@forinda/kickjs-db'

// Migration-replay fixtures — hand-curated `(from, to)` snapshot
// pairs covering common patterns the diff engine emits SQL for.
// Each fixture is replayed end-to-end (apply → introspect → reverse
// → introspect → re-apply → introspect) against real PostgreSQL in
// `migration-replay-pg.test.ts`.
//
// Constraints on what types / defaults are usable here:
// - Types must introspect-round-trip identically to how the emit
//   writes them. `serial`, `varchar(N)`, `text`, `integer`,
//   `boolean`, `timestamptz`, `bigint`, `smallint`, `numeric` are
//   safe; PG canonicalises them back to the same form. Avoid
//   `bigserial` (PG introspects as `bigint` + sequence default —
//   shapes differently).
// - Defaults must canonicalise stably. `CURRENT_TIMESTAMP`, `true`,
//   `false`, numeric literals, single-quoted string literals all
//   round-trip cleanly per `introspect-pg.test.ts`. Avoid function
//   calls beyond `CURRENT_TIMESTAMP`.
// - No `bigserial`, `gen_random_uuid()`, or extension-dependent
//   defaults — those introduce environment-specific normalization
//   that has its own dedicated coverage elsewhere.

const empty: SchemaSnapshot = {
  version: 1,
  dialect: 'postgres',
  tables: {},
}

const usersV1: SchemaSnapshot = {
  version: 1,
  dialect: 'postgres',
  tables: {
    users: {
      name: 'users',
      columns: {
        id: { name: 'id', type: 'serial', nullable: false, default: null, primaryKey: true },
        email: {
          name: 'email',
          type: 'varchar(255)',
          nullable: false,
          default: null,
          primaryKey: false,
        },
      },
      indexes: [],
      foreignKeys: [],
      checks: [],
    },
  },
}

const usersV2WithName: SchemaSnapshot = {
  version: 1,
  dialect: 'postgres',
  tables: {
    users: {
      name: 'users',
      columns: {
        id: { name: 'id', type: 'serial', nullable: false, default: null, primaryKey: true },
        email: {
          name: 'email',
          type: 'varchar(255)',
          nullable: false,
          default: null,
          primaryKey: false,
        },
        name: {
          name: 'name',
          type: 'varchar(120)',
          nullable: true,
          default: null,
          primaryKey: false,
        },
      },
      indexes: [],
      foreignKeys: [],
      checks: [],
    },
  },
}

const usersV3WithPosts: SchemaSnapshot = {
  version: 1,
  dialect: 'postgres',
  tables: {
    users: usersV2WithName.tables.users!,
    posts: {
      name: 'posts',
      columns: {
        id: { name: 'id', type: 'serial', nullable: false, default: null, primaryKey: true },
        author_id: {
          name: 'author_id',
          type: 'integer',
          nullable: false,
          default: null,
          primaryKey: false,
        },
        title: {
          name: 'title',
          type: 'varchar(200)',
          nullable: false,
          default: null,
          primaryKey: false,
        },
      },
      indexes: [],
      foreignKeys: [
        {
          name: 'posts_author_fk',
          columns: ['author_id'],
          refTable: 'users',
          refColumns: ['id'],
          onDelete: 'cascade',
          onUpdate: 'no_action',
        },
      ],
      checks: [],
    },
  },
}

const usersV4WithUniqueIndex: SchemaSnapshot = {
  version: 1,
  dialect: 'postgres',
  tables: {
    users: {
      ...usersV3WithPosts.tables.users!,
      indexes: [
        {
          name: 'users_email_unique',
          columns: ['email'],
          unique: true,
        },
      ],
    },
    posts: usersV3WithPosts.tables.posts!,
  },
}

const usersV5NameNullable: SchemaSnapshot = {
  version: 1,
  dialect: 'postgres',
  tables: {
    users: {
      ...usersV4WithUniqueIndex.tables.users!,
      columns: {
        ...usersV4WithUniqueIndex.tables.users!.columns,
        // Add a NOT NULL flag flip on `name`. Includes a default so
        // existing rows wouldn't break — though the test schema is
        // empty so the alter is risk-free here.
        name: {
          name: 'name',
          type: 'varchar(120)',
          nullable: false,
          // String-literal defaults are stored UNQUOTED in the
          // snapshot (the `default` field carries the value, not
          // the SQL representation). `emit/pg.ts:formatDefault`
          // wraps it; `introspect-pg.ts:normalizeDefault` strips
          // it back. Storing `"'unknown'"` (with literal quotes)
          // would cycle into `''unknown''` on re-apply.
          default: 'unknown',
          primaryKey: false,
        },
      },
    },
    posts: usersV4WithUniqueIndex.tables.posts!,
  },
}

export interface ReplayFixture {
  /** Short label for failure messages. */
  label: string
  /** Schema state before the migration step. May be the empty snapshot. */
  from: SchemaSnapshot
  /** Schema state after the migration step. */
  to: SchemaSnapshot
}

export const FIXTURES: readonly ReplayFixture[] = [
  { label: 'empty → 1 table with PK', from: empty, to: usersV1 },
  { label: 'add nullable column', from: usersV1, to: usersV2WithName },
  { label: 'add 2nd table with FK', from: usersV2WithName, to: usersV3WithPosts },
  { label: 'add unique index', from: usersV3WithPosts, to: usersV4WithUniqueIndex },
  {
    label: 'alter column nullability + default',
    from: usersV4WithUniqueIndex,
    to: usersV5NameNullable,
  },
]
