import { Service, Autowired, Logger } from '@forinda/kickjs-core'
import { Job, Process } from '@forinda/kickjs-queue'
import type { Job as BullMQJob } from 'bullmq'
import { DrizzleNotificationRepository } from '@/modules/notifications/infrastructure/repositories/drizzle-notification.repository'

const logger = Logger.for('NotificationProcessor')

@Service()
@Job('notifications')
export class NotificationProcessor {
  @Autowired() private notificationRepo!: DrizzleNotificationRepository

  @Process('create-notification')
  async createNotification(
    job: BullMQJob<{
      recipientId: string
      type: 'task_assigned' | 'mentioned' | 'workspace_invite' | 'task_overdue' | 'comment_added'
      title: string
      body: string
      metadata: Record<string, unknown>
    }>,
  ) {
    logger.info(`Creating notification for ${job.data.recipientId}: ${job.data.type}`)
    await this.notificationRepo.create(job.data)
  }
}
