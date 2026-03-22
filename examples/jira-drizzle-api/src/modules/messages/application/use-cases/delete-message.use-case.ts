import { Service, Inject } from '@forinda/kickjs-core'
import { TOKENS } from '@/shared/constants/tokens'
import type { IMessageRepository } from '../../domain/repositories/message.repository'

@Service()
export class DeleteMessageUseCase {
  constructor(
    @Inject(TOKENS.MESSAGE_REPOSITORY)
    private readonly repo: IMessageRepository,
  ) {}

  async execute(id: string) {
    await this.repo.delete(id)
  }
}
