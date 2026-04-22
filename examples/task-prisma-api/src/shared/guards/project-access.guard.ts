import { Container, HttpException, type MiddlewareHandler } from '@forinda/kickjs'
import type { RequestContext } from '@forinda/kickjs'
import { TOKENS } from '@/shared/constants/tokens'
import { ErrorCode } from '@/shared/constants/error-codes'
import { getUser } from '@/shared/utils/auth'
import type { IProjectRepository } from '@/modules/projects/domain/repositories/project.repository'
import type { IWorkspaceMemberRepository } from '@/modules/workspaces/domain/repositories/workspace-member.repository'

export const projectAccessGuard: MiddlewareHandler = async (ctx: RequestContext, next) => {
  const user = getUser(ctx)
  const projectId = ctx.params.projectId || ctx.params.id

  if (!projectId) {
    throw HttpException.badRequest('Project ID is required')
  }

  const container = Container.getInstance()
  const projectRepo = container.resolve<IProjectRepository>(TOKENS.PROJECT_REPOSITORY)

  const project = await projectRepo.findById(projectId)
  if (!project) {
    throw HttpException.notFound(ErrorCode.PROJECT_NOT_FOUND)
  }

  const memberRepo = container.resolve<IWorkspaceMemberRepository>(
    TOKENS.WORKSPACE_MEMBER_REPOSITORY,
  )

  const member = await memberRepo.findByWorkspaceAndUser(project.workspaceId, user.id)
  if (!member) {
    throw HttpException.forbidden(ErrorCode.NOT_WORKSPACE_MEMBER)
  }

  ctx.set('project', project)
  ctx.set('workspaceMember', member)
  next()
}
