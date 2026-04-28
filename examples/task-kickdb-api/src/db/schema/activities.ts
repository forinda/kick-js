import { table, uuid, varchar, jsonb, timestamp, index } from '@forinda/kickjs-db'

import { workspaces } from './workspaces.ts'
import { projects } from './projects.ts'
import { tasks } from './tasks.ts'
import { users } from './users.ts'

export const activities = table(
  'activities',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: uuid().references(() => projects.id, { onDelete: 'set_null' }),
    taskId: uuid().references(() => tasks.id, { onDelete: 'set_null' }),
    actorId: uuid()
      .notNull()
      .references(() => users.id),
    action: varchar(100).notNull(),
    changes: jsonb<Record<string, unknown>>(),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => ({
    workspaceIdx: index('activities_workspace_idx').on(t.workspaceId),
    actorIdx: index('activities_actor_idx').on(t.actorId),
    createdIdx: index('activities_created_idx').on(t.createdAt),
  }),
)
