import { test } from 'vitest'
import type { Generated } from 'kysely'
import type { KickDbClient } from '@forinda/kickjs-db'

interface DB {
  users: { id: Generated<string>; email: string; name: string; bio: string | null }
  tags: { id: Generated<number>; name: string }
}
declare const db: KickDbClient<DB>

test('create must supply the required columns where leaves out', () => {
  void db.findOrCreate('users', { where: { email: 'a@x.io' }, create: { name: 'Ada' } })
  void db.findOrCreate('users', { where: { email: 'a@x.io', name: 'Ada' } })
  void db.findOrCreate('tags', { where: { name: 'urgent' } })
  // @ts-expect-error name is required and not in where
  void db.findOrCreate('users', { where: { email: 'a@x.io' } })
  // @ts-expect-error name is required and not in where
  void db.findOrCreate('users', { where: { email: 'a@x.io' }, create: { bio: 'hi' } })
  // @ts-expect-error not a column
  void db.findOrCreate('tags', { where: { nmae: 'urgent' } })
  // @ts-expect-error not a column, next to one that is
  void db.findOrCreate('tags', { where: { name: 'urgent', nmae: 'urgent' } })
})

test('a where key that may be absent stays required in create', () => {
  const where: { email?: string; name: string } = { name: 'Ada' }
  // @ts-expect-error email may be missing from where
  void db.findOrCreate('users', { where })
  void db.findOrCreate('users', { where, create: { email: 'a@x.io' } })
})
