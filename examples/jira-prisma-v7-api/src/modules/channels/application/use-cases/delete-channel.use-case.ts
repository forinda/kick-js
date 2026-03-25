import { Service, Inject } from '@forinda/kickjs-core'
import { TOKENS } from '@/shared/constants/tokens'
import type { IChannelRepository } from '../../domain/repositories/channel.repository'

@Service()
export class DeleteChannelUseCase {
  constructor(
    @Inject(TOKENS.CHANNEL_REPOSITORY)
    private readonly repo: IChannelRepository,
  ) {}

  async execute(id: string) {
    await this.repo.delete(id)
  }
}
