import { Service, Inject } from '@forinda/kickjs-core'
import { TOKENS } from '@/shared/constants/tokens'
import type { IMessageRepository } from '../../domain/repositories/message.repository'

@Service()
export class ListMessagesUseCase {
  constructor(
    @Inject(TOKENS.MESSAGE_REPOSITORY)
    private readonly repo: IMessageRepository,
  ) {}

  async execute(channelId: string, cursor?: string, limit?: number) {
    return this.repo.findByChannel(channelId, cursor, limit)
  }
}
