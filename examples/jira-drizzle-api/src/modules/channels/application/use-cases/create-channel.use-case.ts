import { Service, Inject } from '@forinda/kickjs-core'
import { TOKENS } from '@/shared/constants/tokens'
import type {
  IChannelRepository,
  IChannelMemberRepository,
} from '../../domain/repositories/channel.repository'
import type { CreateChannelDTO } from '../dtos/create-channel.dto'

@Service()
export class CreateChannelUseCase {
  constructor(
    @Inject(TOKENS.CHANNEL_REPOSITORY)
    private readonly repo: IChannelRepository,
    @Inject(TOKENS.CHANNEL_MEMBER_REPOSITORY)
    private readonly memberRepo: IChannelMemberRepository,
  ) {}

  async execute(dto: CreateChannelDTO, createdById: string) {
    const channel = await this.repo.create({ ...dto, createdById })
    await this.memberRepo.addMember(channel.id, createdById)
    return channel
  }
}
