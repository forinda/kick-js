import { Service, Inject } from '@forinda/kickjs'
import { PRISMA_CLIENT } from '@forinda/kickjs-prisma'
import type { PrismaClient } from '@prisma/client'
import {
  ATTACHMENT_REPOSITORY,
  type IAttachmentRepository,
  type NewAttachment,
} from '../../domain/repositories/attachment.repository'

@Service()
export class CreateAttachmentUseCase {
  constructor(
    @Inject(ATTACHMENT_REPOSITORY) private readonly repo: IAttachmentRepository,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  async execute(data: Omit<NewAttachment, 'uploaderId'>, uploaderId: string) {
    const attachment = await this.repo.create({
      ...data,
      uploaderId,
    })

    // Increment attachment count on task
    await this.prisma.task.update({
      where: { id: data.taskId },
      data: { attachmentCount: { increment: 1 } },
    })

    return attachment
  }
}
