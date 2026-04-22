import { Service, Autowired, Logger } from '@forinda/kickjs'
import { Job, Process } from '@forinda/kickjs-queue'
import type { Job as BullMQJob } from 'bullmq'
import { DrizzleActivityRepository } from '@/modules/activities/infrastructure/repositories/drizzle-activity.repository'

const logger = Logger.for('ActivityProcessor')

@Service()
@Job('activity')
export class ActivityProcessor {
  @Autowired() private activityRepo!: DrizzleActivityRepository

  @Process('log-activity')
  async logActivity(
    job: BullMQJob<{
      workspaceId: string
      projectId?: string
      taskId?: string
      actorId: string
      action: string
      changes?: Record<string, unknown>
    }>,
  ) {
    logger.info(`Logging activity: ${job.data.action} by ${job.data.actorId}`)
    await this.activityRepo.create(job.data)
  }
}
