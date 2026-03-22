import { pgTable, varchar, uuid, jsonb, timestamp } from 'drizzle-orm/pg-core'
import { workspaces } from './workspaces'
import { projects } from './projects'
import { tasks } from './tasks'
import { users } from './users'

export const activities = pgTable('activities', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id')
    .references(() => workspaces.id, { onDelete: 'cascade' })
    .notNull(),
  projectId: uuid('project_id').references(() => projects.id, {
    onDelete: 'set null',
  }),
  taskId: uuid('task_id').references(() => tasks.id, {
    onDelete: 'set null',
  }),
  actorId: uuid('actor_id')
    .references(() => users.id)
    .notNull(),
  action: varchar('action', { length: 100 }).notNull(),
  changes: jsonb('changes').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
