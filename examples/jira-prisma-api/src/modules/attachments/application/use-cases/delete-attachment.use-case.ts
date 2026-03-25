import { Service, Inject } from '@forinda/kickjs-core'
import { PRISMA_CLIENT } from '@forinda/kickjs-prisma'
import type { PrismaClient } from '@prisma/client'
import {
  ATTACHMENT_REPOSITORY,
  type IAttachmentRepository,
} from '../../domain/repositories/attachment.repository'

@Service()
export class DeleteAttachmentUseCase {
  constructor(
    @Inject(ATTACHMENT_REPOSITORY) private readonly repo: IAttachmentRepository,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  async execute(id: string) {
    const attachment = await this.repo.findById(id)
    if (!attachment) return

    await this.repo.delete(id)

    // Decrement attachment count on task (minimum 0)
    await this.prisma.task.update({
      where: { id: attachment.taskId },
      data: { attachmentCount: { decrement: 1 } },
    })
  }
}
