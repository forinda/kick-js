import { Controller, Get, Post, Put, Delete, Autowired, Middleware } from '@forinda/kickjs'
import type { RequestContext } from '@forinda/kickjs'
import { ApiTags, ApiBearerAuth } from '@forinda/kickjs-swagger'
import { authBridgeMiddleware } from '@/shared/presentation/middlewares/auth-bridge.middleware'
import { getUser } from '@/shared/utils/auth'
import { successResponse } from '@/shared/application/api-response.dto'
import { CreateWorkspaceUseCase } from '../application/use-cases/create-workspace.use-case'
import { GetWorkspaceUseCase } from '../application/use-cases/get-workspace.use-case'
import { ListWorkspacesUseCase } from '../application/use-cases/list-workspaces.use-case'
import { UpdateWorkspaceUseCase } from '../application/use-cases/update-workspace.use-case'
import { DeleteWorkspaceUseCase } from '../application/use-cases/delete-workspace.use-case'
import { InviteMemberUseCase } from '../application/use-cases/invite-member.use-case'
import { UpdateMemberRoleUseCase } from '../application/use-cases/update-member-role.use-case'
import { RemoveMemberUseCase } from '../application/use-cases/remove-member.use-case'
import { ListMembersUseCase } from '../application/use-cases/list-members.use-case'
import { LeaveWorkspaceUseCase } from '../application/use-cases/leave-workspace.use-case'
import { createWorkspaceSchema } from '../application/dtos/create-workspace.dto'
import { updateWorkspaceSchema } from '../application/dtos/update-workspace.dto'
import { inviteMemberSchema } from '../application/dtos/invite-member.dto'
import { updateMemberRoleSchema } from '../application/dtos/update-member-role.dto'

@Controller()
@Middleware(authBridgeMiddleware)
@ApiBearerAuth()
export class WorkspaceController {
  @Autowired() private createWorkspaceUseCase!: CreateWorkspaceUseCase
  @Autowired() private getWorkspaceUseCase!: GetWorkspaceUseCase
  @Autowired() private listWorkspacesUseCase!: ListWorkspacesUseCase
  @Autowired() private updateWorkspaceUseCase!: UpdateWorkspaceUseCase
  @Autowired() private deleteWorkspaceUseCase!: DeleteWorkspaceUseCase
  @Autowired() private inviteMemberUseCase!: InviteMemberUseCase
  @Autowired() private updateMemberRoleUseCase!: UpdateMemberRoleUseCase
  @Autowired() private removeMemberUseCase!: RemoveMemberUseCase
  @Autowired() private listMembersUseCase!: ListMembersUseCase
  @Autowired() private leaveWorkspaceUseCase!: LeaveWorkspaceUseCase

  @Post('/', { body: createWorkspaceSchema, name: 'CreateWorkspace' })
  @ApiTags('Workspace')
  async create(ctx: RequestContext) {
    const user = getUser(ctx)
    const result = await this.createWorkspaceUseCase.execute(ctx.body, user.id)
    ctx.created(successResponse(result))
  }

  @Get('/')
  @ApiTags('Workspace')
  async list(ctx: RequestContext) {
    const user = getUser(ctx)
    const workspaces = await this.listWorkspacesUseCase.executeForUser(user.id)
    ctx.json(successResponse(workspaces))
  }

  @Get('/:id')
  @ApiTags('Workspace')
  async getById(ctx: RequestContext) {
    const result = await this.getWorkspaceUseCase.execute(ctx.params.id)
    if (!result) return ctx.notFound('Workspace not found')
    ctx.json(successResponse(result))
  }

  @Put('/:id', { body: updateWorkspaceSchema, name: 'UpdateWorkspace' })
  @ApiTags('Workspace')
  async update(ctx: RequestContext) {
    const result = await this.updateWorkspaceUseCase.execute(ctx.params.id, ctx.body)
    ctx.json(successResponse(result))
  }

  @Delete('/:id')
  @ApiTags('Workspace')
  async remove(ctx: RequestContext) {
    await this.deleteWorkspaceUseCase.execute(ctx.params.id)
    ctx.noContent()
  }

  // --- Member management ---

  @Get('/:id/members')
  @ApiTags('Workspace')
  async listMembers(ctx: RequestContext) {
    const members = await this.listMembersUseCase.execute(ctx.params.id)
    ctx.json(successResponse(members))
  }

  @Post('/:id/members', { body: inviteMemberSchema, name: 'InviteMember' })
  @ApiTags('Workspace')
  async inviteMember(ctx: RequestContext) {
    const result = await this.inviteMemberUseCase.execute(ctx.params.id, ctx.body)
    ctx.created(successResponse(result))
  }

  @Put('/:id/members/:userId', {
    body: updateMemberRoleSchema,
    name: 'UpdateMemberRole',
  })
  @ApiTags('Workspace')
  async updateMemberRole(ctx: RequestContext) {
    const result = await this.updateMemberRoleUseCase.execute(
      ctx.params.id,
      ctx.params.userId,
      ctx.body.role,
    )
    ctx.json(successResponse(result))
  }

  @Delete('/:id/members/:userId')
  @ApiTags('Workspace')
  async removeMember(ctx: RequestContext) {
    await this.removeMemberUseCase.execute(ctx.params.id, ctx.params.userId)
    ctx.noContent()
  }

  @Post('/:id/leave')
  @ApiTags('Workspace')
  async leave(ctx: RequestContext) {
    const user = getUser(ctx)
    await this.leaveWorkspaceUseCase.execute(ctx.params.id, user.id)
    ctx.json(successResponse(null, 'Left workspace'))
  }
}
