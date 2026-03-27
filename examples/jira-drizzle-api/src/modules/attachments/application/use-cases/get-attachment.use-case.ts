import { Service, Inject } from '@forinda/kickjs-core'
import {
  ATTACHMENT_REPOSITORY,
  type IAttachmentRepository,
} from '../../domain/repositories/attachment.repository'

@Service()
export class GetAttachmentUseCase {
  constructor(@Inject(ATTACHMENT_REPOSITORY) private readonly repo: IAttachmentRepository) {}

  async execute(id: string) {
    return this.repo.findById(id)
  }
}
