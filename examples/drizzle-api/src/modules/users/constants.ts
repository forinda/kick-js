import type { DrizzleQueryParamsConfig } from '@forinda/kickjs-drizzle'
import { users } from '@/db/schema'

export const USERS_QUERY_CONFIG: DrizzleQueryParamsConfig = {
  columns: {
    name: users.name,
    email: users.email,
    role: users.role,
  },
  sortable: {
    name: users.name,
    email: users.email,
    createdAt: users.createdAt,
  },
  searchColumns: [users.name, users.email],
}
