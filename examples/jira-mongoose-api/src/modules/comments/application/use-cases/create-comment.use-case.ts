import { Service, Inject, Logger } from '@forinda/kickjs';
import { QUEUE_MANAGER, type QueueService } from '@forinda/kickjs-queue';
import { TOKENS } from '@/shared/constants/tokens';
import type { ICommentRepository } from '../../domain/repositories/comment.repository';
import type { ITaskRepository } from '@/modules/tasks/domain/repositories/task.repository';
import type { IUserRepository } from '@/modules/users/domain/repositories/user.repository';
import type { CreateCommentDto } from '../dtos/create-comment.dto';

const logger = Logger.for('CreateCommentUseCase');

@Service()
export class CreateCommentUseCase {
  constructor(
    @Inject(TOKENS.COMMENT_REPOSITORY) private commentRepo: ICommentRepository,
    @Inject(TOKENS.TASK_REPOSITORY) private taskRepo: ITaskRepository,
    @Inject(TOKENS.USER_REPOSITORY) private userRepo: IUserRepository,
    @Inject(QUEUE_MANAGER) private queueService: QueueService,
  ) {}

  async execute(taskId: string, authorId: string, dto: CreateCommentDto) {
    // Parse @mentions
    const mentionMatches = dto.body.match(/@([a-zA-Z0-9._-]+)/g) || [];
    const mentionEmails = mentionMatches.map((m) => m.slice(1));
    const mentionUsers = await Promise.all(
      mentionEmails.map((email) => this.userRepo.findByEmail(email)),
    );
    const mentions = mentionUsers.filter(Boolean).map((u) => u!._id);

    const comment = await this.commentRepo.create({
      taskId: taskId as any,
      authorId: authorId as any,
      body: dto.body,
      mentions: mentions as any[],
      parentCommentId: dto.parentCommentId as any,
    });

    await this.taskRepo.incrementCommentCount(taskId, 1);

    // Queue mention notification emails
    const task = await this.taskRepo.findById(taskId);
    const author = await this.userRepo.findById(authorId);
    const mentionedUsers = mentionUsers.filter(Boolean);

    for (const user of mentionedUsers) {
      if (!user || user._id.toString() === authorId) continue;
      try {
        await this.queueService.add('email', 'send-mentioned', {
          email: user.email,
          taskKey: task?.key ?? taskId,
          mentionedBy: author ? `${author.firstName} ${author.lastName}` : 'Someone',
        });
      } catch (err) {
        logger.warn(`Failed to queue mention email for ${user.email}`);
      }
    }

    return comment;
  }
}
