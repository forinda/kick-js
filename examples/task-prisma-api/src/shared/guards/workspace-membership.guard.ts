import { Container, HttpException, type MiddlewareHandler } from '@forinda/kickjs'
import type { RequestContext } from '@forinda/kickjs'
import { TOKENS } from '@/shared/constants/tokens'
import { ErrorCode } from '@/shared/constants/error-codes'
import { getUser } from '@/shared/utils/auth'
import type { IWorkspaceMemberRepository } from '@/modules/workspaces/domain/repositories/workspace-member.repository'

export const workspaceMembershipGuard: MiddlewareHandler = async (ctx: RequestContext, next) => {
  const user = getUser(ctx)
  const workspaceId = ctx.params.workspaceId || ctx.params.id

  if (!workspaceId) {
    throw HttpException.badRequest('Workspace ID is required')
  }

  const container = Container.getInstance()
  const memberRepo = container.resolve<IWorkspaceMemberRepository>(
    TOKENS.WORKSPACE_MEMBER_REPOSITORY,
  )

  const member = await memberRepo.findByWorkspaceAndUser(workspaceId, user.id)
  if (!member) {
    throw HttpException.forbidden(ErrorCode.NOT_WORKSPACE_MEMBER)
  }

  ctx.set('workspaceMember', member)
  next()
}

export const requireWorkspaceRole = (...roles: string[]): MiddlewareHandler => {
  return async (ctx: RequestContext, next) => {
    const user = getUser(ctx)
    const workspaceId = ctx.params.workspaceId || ctx.params.id

    const container = Container.getInstance()
    const memberRepo = container.resolve<IWorkspaceMemberRepository>(
      TOKENS.WORKSPACE_MEMBER_REPOSITORY,
    )

    const member = await memberRepo.findByWorkspaceAndUser(workspaceId, user.id)
    if (!member) {
      throw HttpException.forbidden(ErrorCode.NOT_WORKSPACE_MEMBER)
    }

    if (!roles.includes(member.role)) {
      throw HttpException.forbidden(ErrorCode.FORBIDDEN)
    }

    ctx.set('workspaceMember', member)
    next()
  }
}
