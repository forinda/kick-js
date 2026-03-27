import { Controller, Get, Post, Put, Delete, Autowired, Middleware } from '@forinda/kickjs'
import type { RequestContext } from '@forinda/kickjs'
import { ApiTags, ApiBearerAuth } from '@forinda/kickjs-swagger'
import { authBridgeMiddleware } from '@/shared/presentation/middlewares/auth-bridge.middleware'
import { successResponse } from '@/shared/application/api-response.dto'
import { CreateProjectUseCase } from '../application/use-cases/create-project.use-case'
import { GetProjectUseCase } from '../application/use-cases/get-project.use-case'
import { ListProjectsUseCase } from '../application/use-cases/list-projects.use-case'
import { UpdateProjectUseCase } from '../application/use-cases/update-project.use-case'
import { DeleteProjectUseCase } from '../application/use-cases/delete-project.use-case'
import { createProjectSchema } from '../application/dtos/create-project.dto'
import { updateProjectSchema } from '../application/dtos/update-project.dto'

@Controller()
@Middleware(authBridgeMiddleware)
@ApiBearerAuth()
export class ProjectController {
  @Autowired() private createProjectUseCase!: CreateProjectUseCase
  @Autowired() private getProjectUseCase!: GetProjectUseCase
  @Autowired() private listProjectsUseCase!: ListProjectsUseCase
  @Autowired() private updateProjectUseCase!: UpdateProjectUseCase
  @Autowired() private deleteProjectUseCase!: DeleteProjectUseCase

  @Post('/', { body: createProjectSchema, name: 'CreateProject' })
  @ApiTags('Project')
  async create(ctx: RequestContext) {
    const result = await this.createProjectUseCase.execute(ctx.body)
    ctx.created(successResponse(result))
  }

  @Get('/workspace/:workspaceId')
  @ApiTags('Project')
  async listByWorkspace(ctx: RequestContext) {
    const projects = await this.listProjectsUseCase.executeByWorkspace(ctx.params.workspaceId)
    ctx.json(successResponse(projects))
  }

  @Get('/:id')
  @ApiTags('Project')
  async getById(ctx: RequestContext) {
    const result = await this.getProjectUseCase.execute(ctx.params.id)
    if (!result) return ctx.notFound('Project not found')
    ctx.json(successResponse(result))
  }

  @Put('/:id', { body: updateProjectSchema, name: 'UpdateProject' })
  @ApiTags('Project')
  async update(ctx: RequestContext) {
    const result = await this.updateProjectUseCase.execute(ctx.params.id, ctx.body)
    ctx.json(successResponse(result))
  }

  @Delete('/:id')
  @ApiTags('Project')
  async remove(ctx: RequestContext) {
    await this.deleteProjectUseCase.execute(ctx.params.id)
    ctx.noContent()
  }
}
