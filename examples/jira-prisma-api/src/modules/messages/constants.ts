import type { QueryParamsConfig } from '@forinda/kickjs-core'

export const MESSAGE_QUERY_CONFIG: QueryParamsConfig = {
  filterable: ['channelId', 'senderId'],
  sortable: ['createdAt'],
  searchable: ['content'],
}
