import { pgTable, varchar, text, boolean, timestamp } from 'drizzle-orm/pg-core'
import { globalRoleEnum } from './enums'
import { baseColumns } from './base-columns'

export const users = pgTable('users', {
  ...baseColumns(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  passwordHash: text('password_hash').notNull(),
  firstName: varchar('first_name', { length: 100 }).notNull(),
  lastName: varchar('last_name', { length: 100 }).notNull(),
  avatarUrl: text('avatar_url'),
  globalRole: globalRoleEnum('global_role').default('user').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  lastLoginAt: timestamp('last_login_at'),
})
