import { Service, Inject } from '@forinda/kickjs-core'
import { PRISMA_CLIENT } from '@forinda/kickjs-prisma'
import type { PrismaClient } from '@prisma/client'
import {
  COMMENT_REPOSITORY,
  type ICommentRepository,
} from '../../domain/repositories/comment.repository'
import type { CreateCommentDTO } from '../dtos/create-comment.dto'

/** Extract @mentioned user IDs from comment content */
function parseMentions(content: string): string[] {
  const uuidRegex = /@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi
  const matches = content.matchAll(uuidRegex)
  return [...new Set([...matches].map((m) => m[1]))]
}

@Service()
export class CreateCommentUseCase {
  constructor(
    @Inject(COMMENT_REPOSITORY) private readonly repo: ICommentRepository,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  async execute(dto: CreateCommentDTO, authorId: string) {
    const mentions = parseMentions(dto.content)

    const comment = await this.repo.create({
      taskId: dto.taskId,
      authorId,
      content: dto.content,
      mentions,
    })

    // Increment comment count on task
    await this.prisma.task.update({
      where: { id: dto.taskId },
      data: { commentCount: { increment: 1 } },
    })

    return comment
  }
}
