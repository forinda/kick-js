import { Service, Autowired, Logger } from '@forinda/kickjs';
import { Cron } from '../../cron.decorator';
import { TOKENS } from '@/shared/constants/tokens';
import type { ITaskRepository } from '@/modules/tasks/domain/repositories/task.repository';
import type { IUserRepository } from '@/modules/users/domain/repositories/user.repository';
import { QUEUE_MANAGER, type QueueService } from '@forinda/kickjs-queue';

const logger = Logger.for('TaskCronJobs');

@Service()
export class TaskCronJobs {
  @Autowired(TOKENS.TASK_REPOSITORY) private taskRepo!: ITaskRepository;
  @Autowired(TOKENS.USER_REPOSITORY) private userRepo!: IUserRepository;
  @Autowired(QUEUE_MANAGER) private queueService!: QueueService;

  @Cron('0 9 * * *', { description: 'Send overdue task reminders', timezone: 'UTC' })
  async overdueReminders() {
    logger.info('Running overdue task reminders...');

    const overdueTasks = await this.taskRepo.findOverdue();
    for (const task of overdueTasks) {
      for (const assigneeId of task.assigneeIds) {
        const user = await this.userRepo.findById(assigneeId.toString());
        if (user) {
          await this.queueService.add('email', 'send-overdue-reminder', {
            email: user.email,
            taskKey: task.key,
            taskTitle: task.title,
            dueDate: task.dueDate?.toISOString(),
          });
        }
      }
    }
    logger.info(`Sent reminders for ${overdueTasks.length} overdue tasks`);
  }
}
