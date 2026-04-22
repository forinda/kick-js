import { pgTable, varchar, text, uuid, integer, boolean, jsonb, unique } from 'drizzle-orm/pg-core'
import { baseColumns } from './base-columns'
import { users } from './users'
import { workspaces } from './workspaces'

const defaultStatusColumns = [
  { name: 'todo', order: 0, color: '#94a3b8' },
  { name: 'in_progress', order: 1, color: '#3b82f6' },
  { name: 'in_review', order: 2, color: '#f59e0b' },
  { name: 'done', order: 3, color: '#22c55e' },
]

export const projects = pgTable(
  'projects',
  {
    ...baseColumns(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    key: varchar('key', { length: 10 }).notNull(),
    description: text('description'),
    leadId: uuid('lead_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    taskCounter: integer('task_counter').default(0).notNull(),
    isArchived: boolean('is_archived').default(false).notNull(),
    statusColumns: jsonb('status_columns')
      .$type<{ name: string; order: number; color: string }[]>()
      .default(defaultStatusColumns)
      .notNull(),
  },
  (t) => [unique().on(t.workspaceId, t.key)],
)
