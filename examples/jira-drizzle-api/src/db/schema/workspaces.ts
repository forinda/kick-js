import { pgTable, varchar, text, uuid } from 'drizzle-orm/pg-core'
import { baseColumns } from './base-columns'
import { users } from './users'

export const workspaces = pgTable('workspaces', {
  ...baseColumns(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).unique().notNull(),
  description: text('description'),
  ownerId: uuid('owner_id')
    .references(() => users.id)
    .notNull(),
  logoUrl: text('logo_url'),
})
