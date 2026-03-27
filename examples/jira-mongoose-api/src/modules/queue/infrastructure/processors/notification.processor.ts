import { Service, Autowired, Logger } from '@forinda/kickjs-core';
import { Job, Process } from '@forinda/kickjs-queue';
import type { Job as BullMQJob } from 'bullmq';
import { MongoNotificationRepository } from '@/modules/notifications/infrastructure/repositories/mongo-notification.repository';

const logger = Logger.for('NotificationProcessor');

@Service()
@Job('notifications')
export class NotificationProcessor {
  @Autowired() private notificationRepo!: MongoNotificationRepository;

  @Process('create-notification')
  async createNotification(job: BullMQJob<{
    recipientId: string;
    type: string;
    title: string;
    body: string;
    metadata: Record<string, any>;
  }>) {
    logger.info(`Creating notification for ${job.data.recipientId}: ${job.data.type}`);
    await this.notificationRepo.create({
      recipientId: job.data.recipientId as any,
      type: job.data.type as any,
      title: job.data.title,
      body: job.data.body,
      metadata: job.data.metadata,
    });
  }
}
