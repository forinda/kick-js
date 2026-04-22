import type { DrizzleQueryParamsConfig } from '@forinda/kickjs-drizzle'
import { comments } from '@/db/schema'

export const COMMENT_QUERY_CONFIG: DrizzleQueryParamsConfig = {
  columns: {
    taskId: comments.taskId,
    authorId: comments.authorId,
  },
  sortable: {
    createdAt: comments.createdAt,
  },
  searchColumns: [comments.content],
}
