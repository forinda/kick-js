import { Controller, Get, type RequestContext } from '@forinda/kickjs'
import { LoadProject, LoadTenant } from '../../contributors'

/**
 * Class decorator: every route on this controller gets `tenant` populated
 * before its handler runs. Method-level decorators stack on top of this.
 */
@LoadTenant
@Controller('/projects')
export class ProjectsController {
  /**
   * GET /projects/:id
   *
   * Pipeline by the time this handler runs:
   *
   *   global   → requestStartedAt   (StartedAt in bootstrap)
   *   adapter  → flags              (FlagsAdapter.contributors)
   *   module   → auditTrailEnabled  (ProjectsModule.contributors)
   *   class    → tenant             (@LoadTenant on class)
   *   method   → project            (@LoadProject on this method, dependsOn ['tenant'])
   */
  @LoadProject
  @Get('/:id')
  getOne(ctx: RequestContext) {
    return ctx.json({
      requestStartedAt: ctx.get('requestStartedAt'),
      flags: ctx.get('flags'),
      auditTrailEnabled: ctx.get('auditTrailEnabled'),
      tenant: ctx.get('tenant'),
      project: ctx.get('project'),
    })
  }

  /**
   * GET /projects/
   *
   * No method-level contributor — this handler still gets the global,
   * adapter, module, and class keys (everything except `project`).
   */
  @Get('/')
  list(ctx: RequestContext) {
    return ctx.json({
      tenant: ctx.get('tenant'),
      auditTrailEnabled: ctx.get('auditTrailEnabled'),
      flags: ctx.get('flags'),
      // ctx.get('project') is undefined here — `@LoadProject` is method-scoped to getOne
    })
  }
}
