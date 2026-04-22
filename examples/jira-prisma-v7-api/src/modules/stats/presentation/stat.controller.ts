import { Controller, Get, Autowired, Middleware } from '@forinda/kickjs'
import type { RequestContext } from '@forinda/kickjs'
import { ApiTags, ApiBearerAuth } from '@forinda/kickjs-swagger'
import { authBridgeMiddleware } from '@/shared/presentation/middlewares/auth-bridge.middleware'
import { successResponse } from '@/shared/application/api-response.dto'
import { GetWorkspaceStatsUseCase } from '../application/use-cases/get-stat.use-case'
import { GetProjectStatsUseCase } from '../application/use-cases/list-stats.use-case'

@Controller()
@Middleware(authBridgeMiddleware)
@ApiBearerAuth()
export class StatController {
  @Autowired() private workspaceStatsUseCase!: GetWorkspaceStatsUseCase
  @Autowired() private projectStatsUseCase!: GetProjectStatsUseCase

  @Get('/workspace/:workspaceId')
  @ApiTags('Stats')
  async workspaceStats(ctx: RequestContext) {
    const stats = await this.workspaceStatsUseCase.execute(ctx.params.workspaceId)
    ctx.json(successResponse(stats))
  }

  @Get('/project/:projectId')
  @ApiTags('Stats')
  async projectStats(ctx: RequestContext) {
    const stats = await this.projectStatsUseCase.execute(ctx.params.projectId)
    ctx.json(successResponse(stats))
  }

  @Get('/workspace/:workspaceId/stream')
  @ApiTags('Stats')
  async workspaceStatsStream(ctx: RequestContext) {
    const { workspaceId } = ctx.params
    const sse = ctx.sse()

    const sendStats = async () => {
      const stats = await this.workspaceStatsUseCase.execute(workspaceId)
      sse.send(stats, 'workspace:stats')
    }

    await sendStats()
    const interval = setInterval(sendStats, 10000)
    sse.onClose(() => clearInterval(interval))
  }

  @Get('/project/:projectId/stream')
  @ApiTags('Stats')
  async projectStatsStream(ctx: RequestContext) {
    const { projectId } = ctx.params
    const sse = ctx.sse()

    const sendStats = async () => {
      const stats = await this.projectStatsUseCase.execute(projectId)
      sse.send(stats, 'project:stats')
    }

    await sendStats()
    const interval = setInterval(sendStats, 10000)
    sse.onClose(() => clearInterval(interval))
  }
}
