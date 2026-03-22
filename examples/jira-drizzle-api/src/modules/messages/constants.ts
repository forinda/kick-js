import type { DrizzleQueryParamsConfig } from '@forinda/kickjs-drizzle'
import { messages } from '@/db/schema'

export const MESSAGE_QUERY_CONFIG: DrizzleQueryParamsConfig = {
  columns: {
    channelId: messages.channelId,
    senderId: messages.senderId,
  },
  sortable: {
    createdAt: messages.createdAt,
  },
  searchColumns: [messages.content],
}
