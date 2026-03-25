import type { QueryParamsConfig } from '@forinda/kickjs-core'

export const NOTIFICATION_QUERY_CONFIG: QueryParamsConfig = {
  filterable: ['recipientId', 'type', 'isRead'],
  sortable: ['createdAt'],
  searchable: ['title', 'body'],
}
