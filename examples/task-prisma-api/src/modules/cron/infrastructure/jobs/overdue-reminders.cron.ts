import { Service, Inject, Logger } from '@forinda/kickjs'
import { Cron } from '../../cron.decorator'
import { PRISMA_CLIENT } from '@forinda/kickjs-prisma'
import { QUEUE_MANAGER, type QueueService } from '@forinda/kickjs-queue'
import type { PrismaClient } from '@/generated/prisma/client'

const logger = Logger.for('TaskCronJobs')

@Service()
export class TaskCronJobs {
  constructor(
    @Inject(PRISMA_CLIENT) private prisma: PrismaClient,
    @Inject(QUEUE_MANAGER) private queueService: QueueService,
  ) {}

  @Cron('0 9 * * *', { description: 'Send overdue task reminders', timezone: 'UTC' })
  async overdueReminders() {
    logger.info('Running overdue task reminders...')

    const overdueTasks = await this.prisma.task.findMany({
      where: {
        dueDate: { lt: new Date() },
        status: { not: 'done' },
      },
      select: {
        id: true,
        key: true,
        title: true,
        dueDate: true,
        assignees: {
          include: {
            user: { select: { email: true } },
          },
        },
      },
    })

    for (const task of overdueTasks) {
      for (const assignee of task.assignees) {
        await this.queueService.add('email', 'send-overdue-reminder', {
          email: assignee.user.email,
          taskKey: task.key,
          taskTitle: task.title,
          dueDate: task.dueDate?.toISOString(),
        })
      }
    }

    logger.info(`Sent reminders for ${overdueTasks.length} overdue tasks`)
  }
}
