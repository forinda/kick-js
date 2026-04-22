import { Service, Inject } from '@forinda/kickjs'
import { TOKENS } from '@/shared/constants/tokens'
import type { IMessageRepository } from '../../domain/repositories/message.repository'
import type { CreateMessageDTO } from '../dtos/create-message.dto'

/** Extract @mentioned user IDs from message content */
function parseMentions(content: string): string[] {
  const uuidRegex = /@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi
  const matches = content.matchAll(uuidRegex)
  return [...new Set([...matches].map((m) => m[1]))]
}

@Service()
export class CreateMessageUseCase {
  constructor(
    @Inject(TOKENS.MESSAGE_REPOSITORY)
    private readonly repo: IMessageRepository,
  ) {}

  async execute(dto: CreateMessageDTO, senderId: string) {
    const mentions = parseMentions(dto.content)
    return this.repo.create({
      channelId: dto.channelId,
      senderId,
      content: dto.content,
      mentions,
    })
  }
}
