import { Service, Inject, HttpException } from '@forinda/kickjs-core'
import { TOKENS } from '@/shared/constants/tokens'
import type { IMessageRepository } from '../repositories/message.repository'

@Service()
export class MessageDomainService {
  constructor(
    @Inject(TOKENS.MESSAGE_REPOSITORY)
    private readonly repo: IMessageRepository,
  ) {}

  async ensureExists(id: string) {
    const entity = await this.repo.findById(id)
    if (!entity) {
      throw HttpException.notFound('Message not found')
    }
    return entity
  }
}
