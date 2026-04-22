import { Service, Inject, HttpException } from '@forinda/kickjs'
import { TOKENS } from '@/shared/constants/tokens'
import type { IChannelRepository } from '../repositories/channel.repository'

@Service()
export class ChannelDomainService {
  constructor(
    @Inject(TOKENS.CHANNEL_REPOSITORY)
    private readonly repo: IChannelRepository,
  ) {}

  async ensureExists(id: string) {
    const entity = await this.repo.findById(id)
    if (!entity) {
      throw HttpException.notFound('Channel not found')
    }
    return entity
  }
}
