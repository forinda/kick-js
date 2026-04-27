import { describe, it, expect } from 'vitest'
import { emitPg } from '@forinda/kickjs-db'
import type { ChangeSet } from '@forinda/kickjs-db'

describe('emitPg() — indexes & FKs', () => {
  it('CREATE INDEX (non-unique)', () => {
    const cs: ChangeSet = [
      {
        kind: 'addIndex',
        table: 'users',
        index: { name: 'users_email_idx', columns: ['email'], unique: false },
      },
    ]
    expect(emitPg(cs)).toBe('CREATE INDEX "users_email_idx" ON "users" ("email");')
  })

  it('CREATE UNIQUE INDEX', () => {
    const cs: ChangeSet = [
      {
        kind: 'addIndex',
        table: 'users',
        index: { name: 'users_email_unique', columns: ['email'], unique: true },
      },
    ]
    expect(emitPg(cs)).toBe('CREATE UNIQUE INDEX "users_email_unique" ON "users" ("email");')
  })

  it('multi-column unique', () => {
    const cs: ChangeSet = [
      {
        kind: 'addIndex',
        table: 'posts',
        index: { name: 'posts_slug', columns: ['title', 'authorId'], unique: true },
      },
    ]
    expect(emitPg(cs)).toBe('CREATE UNIQUE INDEX "posts_slug" ON "posts" ("title", "authorId");')
  })

  it('ADD FOREIGN KEY with cascade', () => {
    const cs: ChangeSet = [
      {
        kind: 'addForeignKey',
        table: 'posts',
        fk: {
          name: 'posts_author_fk',
          columns: ['authorId'],
          refTable: 'users',
          refColumns: ['id'],
          onDelete: 'cascade',
          onUpdate: 'no_action',
        },
      },
    ]
    expect(emitPg(cs)).toBe(
      'ALTER TABLE "posts" ADD CONSTRAINT "posts_author_fk" ' +
        'FOREIGN KEY ("authorId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;',
    )
  })
})
