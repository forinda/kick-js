import type { RequestContext } from '@forinda/kickjs-http';
import type { MiddlewareHandler } from '@forinda/kickjs-core';
import { Container, HttpException } from '@forinda/kickjs-core';
import { TOKENS } from '@/shared/constants/tokens';
import { ErrorCode } from '@/shared/constants/error-codes';
import type { IProjectRepository } from '@/modules/projects/domain/repositories/project.repository';
import type { IWorkspaceMemberRepository } from '@/modules/workspaces/domain/repositories/workspace-member.repository';

export const projectAccessGuard: MiddlewareHandler = async (ctx: RequestContext, next) => {
  const user = ctx.get('user');
  if (!user) {
    throw HttpException.unauthorized('Authentication required');
  }

  const projectId = ctx.params.projectId;
  if (!projectId) {
    return next();
  }

  const container = Container.getInstance();
  const projectRepo = container.resolve<IProjectRepository>(TOKENS.PROJECT_REPOSITORY);
  const project = await projectRepo.findById(projectId);

  if (!project) {
    throw HttpException.notFound(ErrorCode.PROJECT_NOT_FOUND);
  }

  const memberRepo = container.resolve<IWorkspaceMemberRepository>(TOKENS.WORKSPACE_MEMBER_REPOSITORY);
  const member = await memberRepo.findByUserAndWorkspace(user.id, project.workspaceId.toString());

  if (!member) {
    throw HttpException.forbidden(ErrorCode.NOT_WORKSPACE_MEMBER);
  }

  ctx.set('project', project);
  ctx.set('workspaceMember', member);
  next();
};
