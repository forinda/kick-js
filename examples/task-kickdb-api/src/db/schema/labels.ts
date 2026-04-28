import { table, uuid, varchar, char, timestamp, unique } from '@forinda/kickjs-db'

import { workspaces } from './workspaces.ts'

export const labels = table(
  'labels',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: varchar(100).notNull(),
    color: char(7).notNull(), // #RRGGBB
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp().notNull().defaultNow(),
  },
  (t) => ({
    nameUnique: unique('labels_workspace_name_unique').on(t.workspaceId, t.name),
  }),
)
