import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { introspectSqlite } from '@forinda/kickjs-db'

function db(setup: string) {
  const d = new Database(':memory:')
  d.exec(setup)
  return d
}

describe('introspectSqlite', () => {
  it('reads columns, PK, nullability, defaults', () => {
    const d = db(`
      CREATE TABLE tasks (
        id TEXT NOT NULL DEFAULT (lower(hex(randomblob(16)))),
        title TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (id)
      );
    `)
    const snap = introspectSqlite(d)
    expect(snap.dialect).toBe('sqlite')
    const t = snap.tables.tasks
    expect(Object.keys(t.columns)).toEqual(['id', 'title', 'done'])
    expect(t.columns.id).toMatchObject({ type: 'text', nullable: false, primaryKey: true })
    expect(t.columns.title).toMatchObject({ type: 'text', nullable: false, primaryKey: false })
    expect(t.columns.done).toMatchObject({ type: 'integer', nullable: false, default: '0' })
  })

  it('captures explicit CREATE INDEX but skips constraint auto-indexes', () => {
    const d = db(`
      CREATE TABLE t (id INTEGER PRIMARY KEY, email TEXT UNIQUE, done INTEGER);
      CREATE INDEX t_done_idx ON t (done);
    `)
    const idx = introspectSqlite(d).tables.t.indexes
    // The UNIQUE-constraint auto-index on email is skipped (origin != 'c');
    // only the explicit CREATE INDEX is reported.
    expect(idx).toEqual([{ name: 't_done_idx', columns: ['done'], unique: false }])
  })

  it('reads foreign keys', () => {
    const d = db(`
      CREATE TABLE users (id INTEGER PRIMARY KEY);
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY,
        author_id INTEGER NOT NULL,
        FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE CASCADE
      );
    `)
    const fks = introspectSqlite(d).tables.posts.foreignKeys
    expect(fks).toHaveLength(1)
    expect(fks[0]).toMatchObject({
      columns: ['author_id'],
      refTable: 'users',
      refColumns: ['id'],
      onDelete: 'cascade',
      onUpdate: 'no_action',
    })
  })

  it('excludes the migration bookkeeping tables', () => {
    const d = db(`
      CREATE TABLE kick_migrations (id TEXT);
      CREATE TABLE app (id INTEGER PRIMARY KEY);
    `)
    expect(Object.keys(introspectSqlite(d).tables)).toEqual(['app'])
  })
})
