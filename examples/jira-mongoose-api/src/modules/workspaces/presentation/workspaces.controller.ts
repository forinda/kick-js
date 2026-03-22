import { Controller, Get, Post, Patch, Delete, Middleware, Autowired, ApiQueryParams } from '@forinda/kickjs-core';
import type { RequestContext } from '@forinda/kickjs-http';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@forinda/kickjs-swagger';
import { z } from 'zod';
import { createWorkspaceSchema } from '../application/dtos/create-workspace.dto';
import { updateWorkspaceSchema } from '../application/dtos/update-workspace.dto';
import { inviteMemberSchema } from '../application/dtos/invite-member.dto';
import { updateMemberRoleSchema } from '../application/dtos/update-member-role.dto';
import { CreateWorkspaceUseCase } from '../application/use-cases/create-workspace.use-case';
import { ListWorkspacesUseCase } from '../application/use-cases/list-workspaces.use-case';
import { UpdateWorkspaceUseCase } from '../application/use-cases/update-workspace.use-case';
import { DeleteWorkspaceUseCase } from '../application/use-cases/delete-workspace.use-case';
import { InviteMemberUseCase } from '../application/use-cases/invite-member.use-case';
import { ListMembersUseCase } from '../application/use-cases/list-members.use-case';
import { UpdateMemberRoleUseCase } from '../application/use-cases/update-member-role.use-case';
import { RemoveMemberUseCase } from '../application/use-cases/remove-member.use-case';
import { LeaveWorkspaceUseCase } from '../application/use-cases/leave-workspace.use-case';
import { successResponse } from '@/shared/application/api-response.dto';
import { workspaceMembershipGuard, requireWorkspaceRole } from '@/shared/guards/workspace-membership.guard';
import { authBridgeMiddleware } from '@/shared/presentation/middlewares/auth-bridge.middleware';
import { getUser } from '@/shared/utils/auth';
import { WORKSPACE_QUERY_CONFIG, MEMBER_QUERY_CONFIG } from '@/shared/constants/query-configs';
import { MongoWorkspaceMemberRepository } from '../infrastructure/repositories/mongo-workspace-member.repository';

@ApiTags('Workspaces')
@ApiBearerAuth()
@Middleware(authBridgeMiddleware)
@Controller()
export class WorkspacesController {
  @Autowired() private createWorkspaceUseCase!: CreateWorkspaceUseCase;
  @Autowired() private updateWorkspaceUseCase!: UpdateWorkspaceUseCase;
  @Autowired() private deleteWorkspaceUseCase!: DeleteWorkspaceUseCase;
  @Autowired() private inviteMemberUseCase!: InviteMemberUseCase;
  @Autowired() private updateMemberRoleUseCase!: UpdateMemberRoleUseCase;
  @Autowired() private removeMemberUseCase!: RemoveMemberUseCase;
  @Autowired() private leaveWorkspaceUseCase!: LeaveWorkspaceUseCase;
  @Autowired() private memberRepo!: MongoWorkspaceMemberRepository;

  @Post('/', { body: createWorkspaceSchema })
  @ApiOperation({ summary: 'Create a new workspace' })
  @ApiResponse({ status: 201, description: 'Workspace created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async create(ctx: RequestContext) {
    const user = getUser(ctx);
    const result = await this.createWorkspaceUseCase.execute(user.id, ctx.body);
    ctx.created(successResponse(result, 'Workspace created'));
  }

  @Get('/')
  @ApiOperation({ summary: 'List workspaces for the current user' })
  @ApiResponse({ status: 200, description: 'Paginated list of workspaces' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiQueryParams(WORKSPACE_QUERY_CONFIG)
  async list(ctx: RequestContext) {
    const user = getUser(ctx);
    await ctx.paginate(
      (parsed) => this.memberRepo.findPaginatedForUser(parsed, user.id),
      WORKSPACE_QUERY_CONFIG,
    );
  }

  @Get('/:workspaceId', { params: z.object({ workspaceId: z.string() }) })
  @Middleware(workspaceMembershipGuard)
  @ApiOperation({ summary: 'Get a workspace by ID' })
  @ApiResponse({ status: 200, description: 'Workspace retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Not a member of this workspace' })
  @ApiResponse({ status: 404, description: 'Workspace not found' })
  async getOne(ctx: RequestContext) {
    const workspace = ctx.get('workspaceMember');
    ctx.json(successResponse(workspace));
  }

  @Patch('/:workspaceId', { params: z.object({ workspaceId: z.string() }), body: updateWorkspaceSchema })
  @Middleware(workspaceMembershipGuard, requireWorkspaceRole('admin'))
  @ApiOperation({ summary: 'Update a workspace' })
  @ApiResponse({ status: 200, description: 'Workspace updated' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Requires admin role' })
  async update(ctx: RequestContext) {
    const result = await this.updateWorkspaceUseCase.execute(ctx.params.workspaceId, ctx.body);
    ctx.json(successResponse(result));
  }

  @Delete('/:workspaceId', { params: z.object({ workspaceId: z.string() }) })
  @Middleware(workspaceMembershipGuard, requireWorkspaceRole('admin'))
  @ApiOperation({ summary: 'Delete a workspace' })
  @ApiResponse({ status: 200, description: 'Workspace deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Requires admin role' })
  async delete(ctx: RequestContext) {
    await this.deleteWorkspaceUseCase.execute(ctx.params.workspaceId);
    ctx.json(successResponse(null, 'Workspace deleted'));
  }

  @Post('/:workspaceId/invite', { params: z.object({ workspaceId: z.string() }), body: inviteMemberSchema })
  @Middleware(workspaceMembershipGuard, requireWorkspaceRole('admin'))
  @ApiOperation({ summary: 'Invite a member to the workspace' })
  @ApiResponse({ status: 201, description: 'Member invited' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Requires admin role' })
  async invite(ctx: RequestContext) {
    const result = await this.inviteMemberUseCase.execute(ctx.params.workspaceId, ctx.body);
    ctx.created(successResponse(result, 'Member invited'));
  }

  @Get('/:workspaceId/members', { params: z.object({ workspaceId: z.string() }) })
  @Middleware(workspaceMembershipGuard)
  @ApiOperation({ summary: 'List members of a workspace' })
  @ApiResponse({ status: 200, description: 'List of workspace members' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Not a member of this workspace' })
  @ApiQueryParams(MEMBER_QUERY_CONFIG)
  async listMembers(ctx: RequestContext) {
    await ctx.paginate(
      (parsed) => this.memberRepo.findPaginatedMembers(parsed, ctx.params.workspaceId),
      MEMBER_QUERY_CONFIG,
    );
  }

  @Patch('/:workspaceId/members/:userId', {
    params: z.object({ workspaceId: z.string(), userId: z.string() }),
    body: updateMemberRoleSchema,
  })
  @Middleware(workspaceMembershipGuard, requireWorkspaceRole('admin'))
  @ApiOperation({ summary: 'Update a workspace member role' })
  @ApiResponse({ status: 200, description: 'Member role updated' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Requires admin role' })
  async updateMemberRole(ctx: RequestContext) {
    const result = await this.updateMemberRoleUseCase.execute(ctx.params.workspaceId, ctx.params.userId, ctx.body.role);
    ctx.json(successResponse(result));
  }

  @Delete('/:workspaceId/members/:userId', {
    params: z.object({ workspaceId: z.string(), userId: z.string() }),
  })
  @Middleware(workspaceMembershipGuard, requireWorkspaceRole('admin'))
  @ApiOperation({ summary: 'Remove a member from the workspace' })
  @ApiResponse({ status: 200, description: 'Member removed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Requires admin role' })
  async removeMember(ctx: RequestContext) {
    await this.removeMemberUseCase.execute(ctx.params.workspaceId, ctx.params.userId);
    ctx.json(successResponse(null, 'Member removed'));
  }

  @Post('/:workspaceId/leave', { params: z.object({ workspaceId: z.string() }) })
  @Middleware(workspaceMembershipGuard)
  @ApiOperation({ summary: 'Leave a workspace' })
  @ApiResponse({ status: 200, description: 'Left workspace' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Not a member of this workspace' })
  async leave(ctx: RequestContext) {
    const user = getUser(ctx);
    await this.leaveWorkspaceUseCase.execute(ctx.params.workspaceId, user.id);
    ctx.json(successResponse(null, 'Left workspace'));
  }
}
