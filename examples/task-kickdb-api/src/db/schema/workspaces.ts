import { table, uuid, varchar, text, timestamp, index } from '@forinda/kickjs-db'

import { users } from './users.ts'

export const workspaces = table(
  'workspaces',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: varchar(255).notNull(),
    slug: varchar(255).notNull().unique(),
    description: text(),
    ownerId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    logoUrl: text(),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp().notNull().defaultNow(),
  },
  (t) => ({
    ownerIdx: index('workspaces_owner_idx').on(t.ownerId),
  }),
)
