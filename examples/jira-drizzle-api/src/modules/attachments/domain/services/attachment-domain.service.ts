import { Service, Inject, HttpException } from '@forinda/kickjs-core'
import {
  ATTACHMENT_REPOSITORY,
  type IAttachmentRepository,
} from '../repositories/attachment.repository'

@Service()
export class AttachmentDomainService {
  constructor(@Inject(ATTACHMENT_REPOSITORY) private readonly repo: IAttachmentRepository) {}

  async ensureExists(id: string) {
    const entity = await this.repo.findById(id)
    if (!entity) {
      throw HttpException.notFound('Attachment not found')
    }
    return entity
  }
}
