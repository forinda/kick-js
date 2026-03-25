import type { QueryParamsConfig } from '@forinda/kickjs-core'

export const COMMENT_QUERY_CONFIG: QueryParamsConfig = {
  filterable: ['taskId', 'authorId'],
  sortable: ['createdAt'],
  searchable: ['content'],
}
