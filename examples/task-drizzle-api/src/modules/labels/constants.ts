import type { DrizzleQueryParamsConfig } from '@forinda/kickjs-drizzle'
import { labels } from '@/db/schema'

export const LABEL_QUERY_CONFIG: DrizzleQueryParamsConfig = {
  columns: {
    name: labels.name,
    color: labels.color,
    workspaceId: labels.workspaceId,
  },
  sortable: {
    name: labels.name,
    createdAt: labels.createdAt,
  },
  searchColumns: [labels.name],
}
