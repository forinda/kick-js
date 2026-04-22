import { Service, Inject } from '@forinda/kickjs'
import { TOKENS } from '@/shared/constants/tokens'
import type { IMessageRepository } from '../../domain/repositories/message.repository'
import type { UpdateMessageDTO } from '../dtos/update-message.dto'

@Service()
export class UpdateMessageUseCase {
  constructor(
    @Inject(TOKENS.MESSAGE_REPOSITORY)
    private readonly repo: IMessageRepository,
  ) {}

  async execute(id: string, dto: UpdateMessageDTO) {
    return this.repo.update(id, { content: dto.content })
  }
}
