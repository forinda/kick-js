import { table, uuid, varchar, text, boolean, timestamp, index } from '@forinda/kickjs-db'

import { globalRole } from './enums.ts'

export const users = table(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    email: varchar(255).notNull().unique(),
    passwordHash: varchar(255).notNull(),
    firstName: varchar(100).notNull(),
    lastName: varchar(100).notNull(),
    avatarUrl: text(),
    globalRole: globalRole().notNull().default('user'),
    isActive: boolean().notNull().default('true'),
    lastLoginAt: timestamp(),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp().notNull().defaultNow(),
  },
  (t) => ({
    nameIdx: index('users_name_idx').on(t.firstName, t.lastName),
  }),
)
