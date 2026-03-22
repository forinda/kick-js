import { pgTable, varchar, text, uuid, unique } from 'drizzle-orm/pg-core'
import { baseColumns } from './base-columns'
import { channelTypeEnum } from './enums'
import { workspaces } from './workspaces'
import { projects } from './projects'
import { users } from './users'

export const channels = pgTable(
  'channels',
  {
    ...baseColumns(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    type: channelTypeEnum('type').default('public').notNull(),
    createdById: uuid('created_by_id')
      .references(() => users.id)
      .notNull(),
  },
  (t) => [unique().on(t.workspaceId, t.name)],
)
