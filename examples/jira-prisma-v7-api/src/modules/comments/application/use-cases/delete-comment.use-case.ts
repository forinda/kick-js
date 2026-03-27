import { Service, Inject } from '@forinda/kickjs-core'
import { PRISMA_CLIENT } from '@forinda/kickjs-prisma'
import type { PrismaClient } from '@/generated/prisma/client'
import {
  COMMENT_REPOSITORY,
  type ICommentRepository,
} from '../../domain/repositories/comment.repository'

@Service()
export class DeleteCommentUseCase {
  constructor(
    @Inject(COMMENT_REPOSITORY) private readonly repo: ICommentRepository,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  async execute(id: string) {
    const comment = await this.repo.findById(id)
    if (!comment) return

    await this.repo.delete(id)

    // Decrement comment count on task (minimum 0)
    await this.prisma.task.update({
      where: { id: comment.taskId },
      data: { commentCount: { decrement: 1 } },
    })
  }
}
