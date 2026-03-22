import type { DrizzleQueryParamsConfig } from '@forinda/kickjs-drizzle'
import { projects } from '@/db/schema'

export const PROJECT_QUERY_CONFIG: DrizzleQueryParamsConfig = {
  columns: {
    name: projects.name,
    key: projects.key,
    workspaceId: projects.workspaceId,
    leadId: projects.leadId,
    isArchived: projects.isArchived,
  },
  sortable: {
    name: projects.name,
    key: projects.key,
    createdAt: projects.createdAt,
  },
  searchColumns: [projects.name, projects.key],
}
