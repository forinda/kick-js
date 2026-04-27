import { table, serial, varchar } from '../../src/index'

export const users = table('users', {
  id: serial().primaryKey(),
  email: varchar(255).notNull().unique(),
})
