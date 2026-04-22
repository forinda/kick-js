import { Service, Inject } from '@forinda/kickjs'
import {
  ATTACHMENT_REPOSITORY,
  type IAttachmentRepository,
} from '../../domain/repositories/attachment.repository'
import type { ParsedQuery } from '@forinda/kickjs'

@Service()
export class ListAttachmentsUseCase {
  constructor(@Inject(ATTACHMENT_REPOSITORY) private readonly repo: IAttachmentRepository) {}

  async execute(parsed: ParsedQuery, taskId?: string) {
    return this.repo.findPaginated(parsed, taskId)
  }
}
