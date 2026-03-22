import { pgTable, uuid, timestamp, unique } from 'drizzle-orm/pg-core'
import { workspaceRoleEnum } from './enums'
import { users } from './users'
import { workspaces } from './workspaces'

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    role: workspaceRoleEnum('role').default('member').notNull(),
    joinedAt: timestamp('joined_at').defaultNow().notNull(),
  },
  (t) => [unique().on(t.workspaceId, t.userId)],
)
