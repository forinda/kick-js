// PG ENUM types — declared once, referenced from columns.
// `kick db generate` emits `CREATE TYPE … AS ENUM (…)` ahead of every
// table that uses one.

// pgEnum lives on the PG-only subpath since enum types are
// PostgreSQL-specific. Other dialects can't pick them up.
import { pgEnum } from '@forinda/kickjs-db/pg'

export const globalRole = pgEnum('global_role', 'superadmin', 'user')

export const workspaceRole = pgEnum('workspace_role', 'admin', 'member')

export const taskPriority = pgEnum('task_priority', 'critical', 'high', 'medium', 'low', 'none')

export const channelType = pgEnum('channel_type', 'public', 'private', 'direct')

export const notificationType = pgEnum(
  'notification_type',
  'task_assigned',
  'mentioned',
  'workspace_invite',
  'task_overdue',
  'comment_added',
)
