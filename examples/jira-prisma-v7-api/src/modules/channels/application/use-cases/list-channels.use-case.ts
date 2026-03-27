import { Service, Inject } from '@forinda/kickjs-core'
import { TOKENS } from '@/shared/constants/tokens'
import type { IChannelRepository } from '../../domain/repositories/channel.repository'
import type { ParsedQuery } from '@forinda/kickjs-http'

@Service()
export class ListChannelsUseCase {
  constructor(
    @Inject(TOKENS.CHANNEL_REPOSITORY)
    private readonly repo: IChannelRepository,
  ) {}

  async execute(parsed: ParsedQuery, workspaceId: string) {
    return this.repo.findPaginated(parsed, workspaceId)
  }
}
