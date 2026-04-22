import type { AppModuleClass } from '@forinda/kickjs'
import { AuthModule } from './auth/auth.module'
import { UsersModule } from './users/users.module'
import { WorkspacesModule } from './workspaces/workspaces.module'
import { ProjectsModule } from './projects/projects.module'
import { LabelsModule } from './labels/labels.module'
import { TasksModule } from './tasks/tasks.module'
import { CommentsModule } from './comments/comments.module'
import { AttachmentsModule } from './attachments/attachments.module'
import { ActivityModule } from './activity/activity.module'
import { NotificationsModule } from './notifications/notifications.module'
import { ChannelsModule } from './channels/channels.module'
import { MessagesModule } from './messages/messages.module'
import { StatsModule } from './stats/stats.module'
import { QueueModule } from './queue/queue.module'

export const modules: AppModuleClass[] = [
  QueueModule,
  AuthModule,
  UsersModule,
  WorkspacesModule,
  ProjectsModule,
  LabelsModule,
  TasksModule,
  CommentsModule,
  AttachmentsModule,
  ActivityModule,
  NotificationsModule,
  ChannelsModule,
  MessagesModule,
  StatsModule,
]
