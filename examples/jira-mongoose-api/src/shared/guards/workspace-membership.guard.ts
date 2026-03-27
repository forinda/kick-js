import type { RequestContext } from '@forinda/kickjs';
import type { MiddlewareHandler } from '@forinda/kickjs';
import { Container, HttpException } from '@forinda/kickjs';
import { TOKENS } from '@/shared/constants/tokens';
import { ErrorCode } from '@/shared/constants/error-codes';
import type { IWorkspaceMemberRepository } from '@/modules/workspaces/domain/repositories/workspace-member.repository';

export const workspaceMembershipGuard: MiddlewareHandler = async (ctx: RequestContext, next) => {
  const user = ctx.get('user');
  if (!user) {
    throw HttpException.unauthorized('Authentication required');
  }

  const workspaceId = ctx.params.workspaceId;
  if (!workspaceId) {
    return next();
  }

  const container = Container.getInstance();
  const memberRepo = container.resolve<IWorkspaceMemberRepository>(TOKENS.WORKSPACE_MEMBER_REPOSITORY);
  const member = await memberRepo.findByUserAndWorkspace(user.id, workspaceId);

  if (!member) {
    throw HttpException.forbidden(ErrorCode.NOT_WORKSPACE_MEMBER);
  }

  ctx.set('workspaceMember', member);
  next();
};

export function requireWorkspaceRole(...roles: string[]): MiddlewareHandler {
  return async (ctx: RequestContext, next) => {
    const member = ctx.get('workspaceMember');
    if (!member) {
      throw HttpException.forbidden(ErrorCode.NOT_WORKSPACE_MEMBER);
    }

    if (!roles.includes(member.role)) {
      throw HttpException.forbidden(ErrorCode.FORBIDDEN);
    }

    next();
  };
}
