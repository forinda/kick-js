import { Service } from '@forinda/kickjs-core'

// Attachments are immutable — no update use case needed
@Service()
export class UpdateAttachmentUseCase {
  async execute() {
    throw new Error('Attachments are immutable and cannot be updated')
  }
}
