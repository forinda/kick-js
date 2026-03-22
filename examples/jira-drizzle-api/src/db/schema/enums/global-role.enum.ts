import { pgEnum } from 'drizzle-orm/pg-core'

export const globalRoleEnum = pgEnum('global_role', ['superadmin', 'user'])
