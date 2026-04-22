import type { DrizzleQueryParamsConfig } from '@forinda/kickjs-drizzle'
import { channels } from '@/db/schema'

export const CHANNEL_QUERY_CONFIG: DrizzleQueryParamsConfig = {
  columns: {
    workspaceId: channels.workspaceId,
    projectId: channels.projectId,
    type: channels.type,
    createdById: channels.createdById,
  },
  sortable: {
    name: channels.name,
    createdAt: channels.createdAt,
  },
  searchColumns: [channels.name],
}
