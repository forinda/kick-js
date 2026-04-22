import { Service, Inject } from '@forinda/kickjs'
import { TOKENS } from '@/shared/constants/tokens'
import type { IChannelRepository } from '../../domain/repositories/channel.repository'

@Service()
export class GetChannelUseCase {
  constructor(
    @Inject(TOKENS.CHANNEL_REPOSITORY)
    private readonly repo: IChannelRepository,
  ) {}

  async execute(id: string) {
    return this.repo.findById(id)
  }
}
