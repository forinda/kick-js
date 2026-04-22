import { Controller, Get, Autowired, Middleware, ApiQueryParams } from '@forinda/kickjs'
import type { RequestContext } from '@forinda/kickjs'
import { ApiTags, ApiBearerAuth } from '@forinda/kickjs-swagger'
import { authBridgeMiddleware } from '@/shared/presentation/middlewares/auth-bridge.middleware'
import { ListActivitiesUseCase } from '../application/use-cases/list-activities.use-case'
import { ACTIVITY_QUERY_CONFIG } from '../constants'

@Controller()
@Middleware(authBridgeMiddleware)
@ApiBearerAuth()
export class ActivityController {
  @Autowired() private listActivitiesUseCase!: ListActivitiesUseCase

  @Get('/')
  @ApiTags('Activity')
  @ApiQueryParams(ACTIVITY_QUERY_CONFIG)
  async list(ctx: RequestContext) {
    const workspaceId = ctx.query.workspaceId as string
    if (!workspaceId) {
      return ctx.badRequest('workspaceId query parameter is required')
    }

    return ctx.paginate(
      (parsed) =>
        this.listActivitiesUseCase.execute(parsed, {
          workspaceId,
          projectId: ctx.query.projectId as string | undefined,
          taskId: ctx.query.taskId as string | undefined,
        }),
      ACTIVITY_QUERY_CONFIG,
    )
  }
}
