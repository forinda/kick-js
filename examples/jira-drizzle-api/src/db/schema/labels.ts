import { pgTable, varchar, uuid, unique } from 'drizzle-orm/pg-core'
import { baseColumns } from './base-columns'
import { workspaces } from './workspaces'

export const labels = pgTable(
  'labels',
  {
    ...baseColumns(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    color: varchar('color', { length: 7 }).notNull(),
  },
  (t) => [unique().on(t.workspaceId, t.name)],
)
