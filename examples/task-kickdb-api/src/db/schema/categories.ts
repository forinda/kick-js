// Self-referencing table — `parentId` points back at `categories.id`.
// The `() => categories.id` thunk is stored, not invoked, at column build
// time; resolution happens later (extract / render / emit) once the
// `const categories = table(...)` binding has landed.

import { table, uuid, varchar, text, timestamp, index, type ColumnRef } from '@forinda/kickjs-db'

export const categories = table(
  'categories',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: varchar(255).notNull(),
    slug: varchar(255).notNull().unique(),
    description: text(),
    // ColumnRef return annotation breaks TS7022 — TS would otherwise need
    // to infer `categories` to typecheck the body, but the body references
    // `categories` (cycle). With the annotation, inference of the outer
    // const completes; the body is checked at use time.
    parentId: uuid().references((): ColumnRef => categories.id, { onDelete: 'set_null' }),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => ({
    parentIdx: index('categories_parent_idx').on(t.parentId),
  }),
)
