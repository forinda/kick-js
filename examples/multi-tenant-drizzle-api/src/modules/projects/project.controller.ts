import { Controller, Get, Autowired } from '@forinda/kickjs'
import type { RequestContext } from '@forinda/kickjs'
import { Authenticated } from '@forinda/kickjs-auth'
import { TenantDbService } from '../../db/tenant-db.service'

@Controller()
@Authenticated()
export class ProjectController {
  @Autowired() private readonly tenantDb!: TenantDbService

  @Get('/')
  async list(ctx: RequestContext) {
    const db = await this.tenantDb.current()
    const result = db.query('projects')
    return ctx.json({
      tenant: result.tenantId,
      projects: result.rows,
    })
  }
}
