import { Service, Inject, Logger } from '@forinda/kickjs'
import { Cron } from '@forinda/kickjs-cron'
import { DRIZZLE_DB } from '@forinda/kickjs-drizzle'
import { QUEUE_MANAGER, type QueueService } from '@forinda/kickjs-queue'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { eq, lt, and, ne, sql } from 'drizzle-orm'
import { tasks, taskAssignees, users } from '@/db/schema'

const logger = Logger.for('TaskCronJobs')

@Service()
export class TaskCronJobs {
  constructor(
    @Inject(DRIZZLE_DB) private db: PostgresJsDatabase,
    @Inject(QUEUE_MANAGER) private queueService: QueueService,
  ) {}

  @Cron('0 9 * * *', { description: 'Send overdue task reminders', timezone: 'UTC' })
  async overdueReminders() {
    logger.info('Running overdue task reminders...')

    const overdueTasks = await this.db
      .select({
        taskId: tasks.id,
        taskKey: tasks.key,
        taskTitle: tasks.title,
        dueDate: tasks.dueDate,
      })
      .from(tasks)
      .where(and(lt(tasks.dueDate, new Date()), ne(tasks.status, 'done')))

    for (const task of overdueTasks) {
      const assignees = await this.db
        .select({ email: users.email })
        .from(taskAssignees)
        .innerJoin(users, eq(users.id, taskAssignees.userId))
        .where(eq(taskAssignees.taskId, task.taskId))

      for (const assignee of assignees) {
        await this.queueService.add('email', 'send-overdue-reminder', {
          email: assignee.email,
          taskKey: task.taskKey,
          taskTitle: task.taskTitle,
          dueDate: task.dueDate?.toISOString(),
        })
      }
    }

    logger.info(`Sent reminders for ${overdueTasks.length} overdue tasks`)
  }
}
