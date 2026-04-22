import type { DrizzleQueryParamsConfig } from '@forinda/kickjs-drizzle'
import { workspaces } from '@/db/schema'

export const WORKSPACE_QUERY_CONFIG: DrizzleQueryParamsConfig = {
  columns: {
    name: workspaces.name,
    slug: workspaces.slug,
    ownerId: workspaces.ownerId,
  },
  sortable: {
    name: workspaces.name,
    createdAt: workspaces.createdAt,
  },
  searchColumns: [workspaces.name, workspaces.slug],
}
