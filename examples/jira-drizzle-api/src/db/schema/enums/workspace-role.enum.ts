import { pgEnum } from 'drizzle-orm/pg-core'

export const workspaceRoleEnum = pgEnum('workspace_role', ['admin', 'member'])
