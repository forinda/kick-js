import type { DrizzleQueryParamsConfig } from '@forinda/kickjs-drizzle'
import { attachments } from '@/db/schema'

export const ATTACHMENT_QUERY_CONFIG: DrizzleQueryParamsConfig = {
  columns: {
    taskId: attachments.taskId,
    uploaderId: attachments.uploaderId,
    mimeType: attachments.mimeType,
  },
  sortable: {
    fileName: attachments.fileName,
    fileSize: attachments.fileSize,
    createdAt: attachments.createdAt,
  },
  searchColumns: [attachments.fileName],
}
