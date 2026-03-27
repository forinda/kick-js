import type { AppModuleClass } from '@forinda/kickjs-core'
import { UserModule } from './users'
import { AuthModule } from './auth'
import { WorkspaceModule } from './workspaces'
import { ProjectModule } from './projects'
import { TaskModule } from './tasks'
import { LabelModule } from './labels'
import { CommentModule } from './comments'
import { AttachmentModule } from './attachments'
import { NotificationModule } from './notifications'
import { ActivityModule } from './activities'
import { ChannelModule } from './channels'
import { MessageModule } from './messages'
import { StatModule } from './stats'
import { QueueModule } from './queue/queue.module'

export const modules: AppModuleClass[] = [
  UserModule,
  AuthModule,
  WorkspaceModule,
  ProjectModule,
  TaskModule,
  LabelModule,
  CommentModule,
  AttachmentModule,
  NotificationModule,
  ActivityModule,
  ChannelModule,
  MessageModule,
  StatModule,
  QueueModule,
]
