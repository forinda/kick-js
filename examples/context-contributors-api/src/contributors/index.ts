import { defineContextDecorator, type RequestContext } from '@forinda/kickjs'
import { PROJECTS_REPO, type ProjectsRepo } from '../modules/projects/projects.repo'

/**
 * Global contributor — runs on every route via bootstrap({ contributors: [...] }).
 * Stamps the wall-clock at the moment the runner reaches this contributor.
 */
export const StartedAt = defineContextDecorator({
  key: 'requestStartedAt',
  resolve: () => Date.now(),
})

/**
 * Adapter contributor — returned by FlagsAdapter.contributors().
 * Cross-cutting: applies to every route in the app.
 */
export const LoadFlags = defineContextDecorator({
  key: 'flags',
  resolve: () => ({
    beta: process.env.FEATURE_BETA === 'true',
    rolloutPercentage: 25,
  }),
})

/**
 * Module contributor — returned by ProjectsModule.contributors().
 * Per-module scope: only routes mounted under ProjectsModule see this.
 */
export const LoadAuditTrail = defineContextDecorator({
  key: 'auditTrailEnabled',
  resolve: () => true,
})

/**
 * Class contributor — `@LoadTenant` on the ProjectsController class.
 * Applies to every method on that controller.
 */
export const LoadTenant = defineContextDecorator({
  key: 'tenant',
  resolve: (ctx: RequestContext) => ({
    id: (ctx.req.headers['x-tenant-id'] as string) ?? 'demo-tenant',
    name: 'Demo Tenant',
  }),
})

/**
 * Method contributor — `@LoadProject` on a single route.
 * Demonstrates `dependsOn` (waits for `tenant`) and DI (`deps`).
 */
export const LoadProject = defineContextDecorator<
  'project',
  { repo: typeof PROJECTS_REPO },
  RequestContext
>({
  key: 'project',
  dependsOn: ['tenant'],
  deps: { repo: PROJECTS_REPO },
  resolve: (ctx, { repo }) => {
    const tenant = ctx.get('tenant')!
    const project = (repo as ProjectsRepo).find(tenant.id, ctx.params.id as string)
    if (!project) throw new Error(`project ${ctx.params.id} not found in tenant ${tenant.id}`)
    return project
  },
})
