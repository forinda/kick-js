import { Service, Inject } from '@forinda/kickjs-core'
import { TOKENS } from '@/shared/constants/tokens'
import type { IMessageRepository } from '../../domain/repositories/message.repository'

@Service()
export class GetMessageUseCase {
  constructor(
    @Inject(TOKENS.MESSAGE_REPOSITORY)
    private readonly repo: IMessageRepository,
  ) {}

  async execute(id: string) {
    return this.repo.findById(id)
  }
}
