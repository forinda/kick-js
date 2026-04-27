// task-kickdb-api schema — a representative subset of examples/task-prisma-api.
//
// Three tables (users, workspaces, tasks) exercise every M1 surface:
//   - serial PK + uuid PK in the same schema
//   - varchar(n), text, boolean, timestamp(tz), json columns
//   - DEFAULT CURRENT_TIMESTAMP and gen_random_uuid()
//   - foreign keys with CASCADE / SET NULL
//   - single-column unique (auto-named via .unique())
//   - multi-column unique (named, in the constraint callback)
//   - regular indexes
//   - relations() declarations consumed by introspection round-trips

import {
  table,
  relations,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
  integer,
  index,
  unique,
} from '@forinda/kickjs-db'

export const users = table(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    email: varchar(255).notNull().unique(),
    firstName: varchar(100).notNull(),
    lastName: varchar(100).notNull(),
    avatarUrl: text(),
    isActive: boolean().notNull().default('true'),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => ({
    nameIdx: index('users_name_idx').on(t.firstName, t.lastName),
  }),
)

export const workspaces = table(
  'workspaces',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: varchar(255).notNull(),
    slug: varchar(255).notNull().unique(),
    description: text(),
    ownerId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => ({
    ownerIdx: index('workspaces_owner_idx').on(t.ownerId),
  }),
)

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
