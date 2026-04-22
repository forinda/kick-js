import { pgEnum } from 'drizzle-orm/pg-core'

export const taskPriorityEnum = pgEnum('task_priority', [
  'critical',
  'high',
  'medium',
  'low',
  'none',
])
