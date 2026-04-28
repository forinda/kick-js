import {
  table,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  index,
  type ColumnRef,
} from '@forinda/kickjs-db'

import { users } from './users.ts'
import { workspaces } from './workspaces.ts'
import { projects } from './projects.ts'
import { taskPriority } from './enums.ts'

export const tasks = table(
  'tasks',
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    key: varchar(20).notNull().unique(),
    title: varchar(500).notNull(),
    description: text(),
    status: varchar(50).notNull().default('todo'),
    priority: taskPriority().notNull().default('none'),
    reporterId: uuid()
      .notNull()
      .references(() => users.id),
    // Self-reference — `tasks` const isn't bound when this column is
    // built. ColumnRef return type breaks the TS7022 cycle; the thunk
    // resolves later at extract time. See db-schema-types.md for the
    // full pattern.
    parentTaskId: uuid().references((): ColumnRef => tasks.id, { onDelete: 'set_null' }),
    dueDate: timestamp(),
    estimatePoints: integer(),
    orderIndex: integer().notNull().default('0'),
    attachmentCount: integer().notNull().default('0'),
    commentCount: integer().notNull().default('0'),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp().notNull().defaultNow(),
  },
  (t) => ({
    projectIdx: index('tasks_project_idx').on(t.projectId),
    workspaceIdx: index('tasks_workspace_idx').on(t.workspaceId),
    statusIdx: index('tasks_status_idx').on(t.status),
    parentIdx: index('tasks_parent_idx').on(t.parentTaskId),
    reporterIdx: index('tasks_reporter_idx').on(t.reporterId),
  }),
)
