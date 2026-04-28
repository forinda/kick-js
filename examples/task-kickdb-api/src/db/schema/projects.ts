import {
  table,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
  unique,
} from '@forinda/kickjs-db'

import { users } from './users.ts'
import { workspaces } from './workspaces.ts'

interface StatusColumn {
  name: string
  order: number
  color: string
}

const DEFAULT_STATUS_COLUMNS = `'[{"name":"todo","order":0,"color":"#94a3b8"},{"name":"in_progress","order":1,"color":"#3b82f6"},{"name":"in_review","order":2,"color":"#f59e0b"},{"name":"done","order":3,"color":"#22c55e"}]'::jsonb`

export const projects = table(
  'projects',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: varchar(255).notNull(),
    key: varchar(10).notNull(),
    description: text(),
    leadId: uuid().references(() => users.id, { onDelete: 'set_null' }),
    taskCounter: integer().notNull().default('0'),
    isArchived: boolean().notNull().default('false'),
    statusColumns: jsonb<StatusColumn[]>().notNull().default(DEFAULT_STATUS_COLUMNS),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp().notNull().defaultNow(),
  },
  (t) => ({
    keyUnique: unique('projects_workspace_key_unique').on(t.workspaceId, t.key),
    workspaceIdx: index('projects_workspace_idx').on(t.workspaceId),
  }),
)
