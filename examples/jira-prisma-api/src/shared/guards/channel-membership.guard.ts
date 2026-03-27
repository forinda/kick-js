import { Container, HttpException, type MiddlewareHandler } from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'
import { TOKENS } from '@/shared/constants/tokens'
import { ErrorCode } from '@/shared/constants/error-codes'
import { getUser } from '@/shared/utils/auth'
import type { IChannelMemberRepository } from '@/modules/channels/domain/repositories/channel.repository'

export const channelMembershipGuard: MiddlewareHandler = async (ctx: RequestContext, next) => {
  const user = getUser(ctx)
  const channelId = ctx.params.channelId || ctx.params.id

  if (!channelId) {
    throw HttpException.badRequest('Channel ID is required')
  }

  const container = Container.getInstance()
  const memberRepo = container.resolve<IChannelMemberRepository>(TOKENS.CHANNEL_MEMBER_REPOSITORY)

  const member = await memberRepo.findByChannelAndUser(channelId, user.id)
  if (!member) {
    throw HttpException.forbidden(ErrorCode.FORBIDDEN)
  }

  ctx.set('channelMember', member)
  next()
}
