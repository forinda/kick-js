import type { QueryParamsConfig } from '@forinda/kickjs'

export const ATTACHMENT_QUERY_CONFIG: QueryParamsConfig = {
  filterable: ['taskId', 'uploaderId', 'mimeType'],
  sortable: ['fileName', 'fileSize', 'createdAt'],
  searchable: ['fileName'],
}
