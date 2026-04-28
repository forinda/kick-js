import { table, uuid, timestamp, index, unique } from '@forinda/kickjs-db'

import { users } from './users.ts'
import { workspaces } from './workspaces.ts'
import { workspaceRole } from './enums.ts'

// Join table — Prisma's `@@id([workspaceId, userId])` composite PK is
// modelled here as a uuid primary key + a unique index on the pair.
// The DSL doesn't yet expose table-level composite PK; the unique
// constraint enforces the same invariant.
export const workspaceMembers = table(
  'workspace_members',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: workspaceRole().notNull().default('member'),
    joinedAt: timestamp().notNull().defaultNow(),
  },
  (t) => ({
    pairUnique: unique('workspace_members_workspace_user_unique').on(t.workspaceId, t.userId),
    workspaceIdx: index('workspace_members_workspace_idx').on(t.workspaceId),
    userIdx: index('workspace_members_user_idx').on(t.userId),
  }),
)
