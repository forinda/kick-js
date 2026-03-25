import { Service, Inject } from '@forinda/kickjs-core'
import { TOKENS } from '@/shared/constants/tokens'
import type { IChannelRepository } from '../../domain/repositories/channel.repository'
import type { UpdateChannelDTO } from '../dtos/update-channel.dto'

@Service()
export class UpdateChannelUseCase {
  constructor(
    @Inject(TOKENS.CHANNEL_REPOSITORY)
    private readonly repo: IChannelRepository,
  ) {}

  async execute(id: string, dto: UpdateChannelDTO) {
    return this.repo.update(id, dto)
  }
}
