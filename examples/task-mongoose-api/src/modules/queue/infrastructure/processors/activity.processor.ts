import { Service, Autowired, Logger } from '@forinda/kickjs';
import { Job, Process } from '@forinda/kickjs-queue';
import type { Job as BullMQJob } from 'bullmq';
import { MongoActivityRepository } from '@/modules/activity/infrastructure/repositories/mongo-activity.repository';

const logger = Logger.for('ActivityProcessor');

@Service()
@Job('activity')
export class ActivityProcessor {
  @Autowired() private activityRepo!: MongoActivityRepository;

  @Process('log-activity')
  async logActivity(job: BullMQJob<{
    workspaceId: string;
    projectId?: string;
    taskId?: string;
    actorId: string;
    action: string;
    changes?: { field: string; from?: any; to?: any };
  }>) {
    logger.info(`Logging activity: ${job.data.action} by ${job.data.actorId}`);
    await this.activityRepo.create({
      workspaceId: job.data.workspaceId as any,
      projectId: job.data.projectId as any,
      taskId: job.data.taskId as any,
      actorId: job.data.actorId as any,
      action: job.data.action as any,
      changes: job.data.changes,
    });
  }
}
