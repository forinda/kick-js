import { table, uuid, varchar, text, boolean, timestamp, index } from '@forinda/kickjs-db'

export const users = table(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    email: varchar(255).notNull().unique(),
    firstName: varchar(100).notNull(),
    lastName: varchar(100).notNull(),
    avatarUrl: text(),
    isActive: boolean().notNull().default('true'),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => ({
    nameIdx: index('users_name_idx').on(t.firstName, t.lastName),
  }),
)
