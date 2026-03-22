import { pgEnum } from 'drizzle-orm/pg-core'

export const notificationTypeEnum = pgEnum('notification_type', [
  'task_assigned',
  'mentioned',
  'workspace_invite',
  'task_overdue',
  'comment_added',
])
