// Relations live in their own file so per-table modules don't need to
// import each other in a cycle. The barrel re-exports these alongside the
// tables; SchemaToKysely<S> filters non-table entries out of the DB shape.

import { relations } from '@forinda/kickjs-db'

import { users } from './users'
import { workspaces } from './workspaces'
import { tasks } from './tasks'
import { categories } from './categories'

export const usersRelations = relations(users, ({ many }) => ({
  ownedWorkspaces: many(workspaces),
}))

export const workspacesRelations = relations(workspaces, ({ one, many }) => ({
  owner: one(users, { fields: [workspaces.ownerId], references: [users.id] }),
  tasks: many(tasks),
}))

export const tasksRelations = relations(tasks, ({ one }) => ({
  workspace: one(workspaces, { fields: [tasks.workspaceId], references: [workspaces.id] }),
}))

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, { fields: [categories.parentId], references: [categories.id] }),
  children: many(categories),
}))
