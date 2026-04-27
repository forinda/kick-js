import { table, uuid, varchar, text, integer, timestamp, jsonb, index, unique } from '@forinda/kickjs-db'

import { workspaces } from './workspaces'

export const tasks = table(
  'tasks',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    title: varchar(500).notNull(),
    description: text(),
    status: varchar(50).notNull().default('todo'),
    priority: varchar(20).notNull().default('none'),
    estimatePoints: integer(),
    metadata: jsonb<{ tags?: string[]; customFields?: Record<string, string> }>(),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => ({
    workspaceIdx: index('tasks_workspace_idx').on(t.workspaceId),
    statusIdx: index('tasks_status_idx').on(t.status),
    titleWorkspaceUnique: unique('tasks_title_workspace_unique').on(t.title, t.workspaceId),
  }),
)
