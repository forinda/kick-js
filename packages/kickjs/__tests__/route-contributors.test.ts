import 'reflect-metadata'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  Application,
  Container,
  Controller,
  Get,
  defineContextDecorator,
  type RequestContext,
} from '../src/index'

beforeEach(() => Container.reset())

const Tenant = defineContextDecorator({ key: 'tenant', resolve: () => 't1' })
const Project = defineContextDecorator({
  key: 'project',
  dependsOn: ['tenant'],
  resolve: () => 'p1',
})
// The method decorator overrides the module's `locale`.
const MethodLocale = defineContextDecorator({ key: 'locale', resolve: () => 'fr' })
const ModuleLocale = defineContextDecorator({ key: 'locale', resolve: () => 'en' })
const Trace = defineContextDecorator({ key: 'trace', resolve: () => 'x' })

@Tenant
@Controller()
class ProjectsController {
  @Project
  @MethodLocale
  @Get('/:id')
  show(ctx: RequestContext) {
    ctx.json({})
  }

  @Get('/')
  list(ctx: RequestContext) {
    ctx.json([])
  }
}

describe('route contributor introspection', () => {
  it('records each route chain in execution order, with sources and overrides', async () => {
    const app = new Application({
      contributors: [Trace.registration],
      modules: [
        {
          name: 'ProjectsModule',
          contributors: () => [ModuleLocale.registration],
          routes: () => ({ path: '/projects', controller: ProjectsController }),
        } as never,
      ],
    })
    await app.setup()

    const show = app.getRoutes().find((r) => r.handler === 'show')!
    expect(show.pattern).toBe('/api/v1/projects/:id')
    const byKey = Object.fromEntries(show.contributors.map((c) => [c.key, c]))
    expect(byKey.tenant.source).toBe('class')
    expect(byKey.project.source).toBe('method')
    expect(byKey.trace.source).toBe('global')
    expect(byKey.locale.source).toBe('method')
    expect(byKey.locale.overrides).toEqual([expect.objectContaining({ source: 'module' })])
    // Dependencies come first.
    const order = show.contributors.map((c) => c.key)
    expect(order.indexOf('tenant')).toBeLessThan(order.indexOf('project'))

    // The class decorator reaches `list` too; the method ones don't.
    const list = app.getRoutes().find((r) => r.handler === 'list')!
    expect(list.contributors.map((c) => c.key).toSorted()).toEqual(['locale', 'tenant', 'trace'])
  })

  it('getContributors() now includes decorators, once per decorator site', async () => {
    const app = new Application({
      modules: [{ routes: () => ({ path: '/projects', controller: ProjectsController }) } as never],
    })
    await app.setup()
    const decorated = app
      .getContributors()
      .filter((c) => c.source === 'class' || c.source === 'method')
    // @Tenant sits on the class: two routes, one entry.
    expect(decorated.filter((c) => c.key === 'tenant')).toHaveLength(1)
    expect(decorated.map((c) => `${c.source}:${c.key}`).toSorted()).toEqual([
      'class:tenant',
      'method:locale',
      'method:project',
    ])
  })
})

describe('execution order', () => {
  it('lists beforeValidation contributors first, as they run', async () => {
    const Early = defineContextDecorator({
      key: 'early',
      beforeValidation: true,
      resolve: () => 1,
    })
    const Late = defineContextDecorator({ key: 'late', resolve: () => 2 })

    @Controller()
    class OrderController {
      @Early
      @Late
      @Get('/')
      get(ctx: RequestContext) {
        ctx.json({})
      }
    }
    const app = new Application({
      modules: [{ routes: () => ({ path: '/o', controller: OrderController }) } as never],
    })
    await app.setup()
    const route = app.getRoutes().find((r) => r.controller === 'OrderController')!
    expect(route.contributors.map((c) => c.key)).toEqual(['early', 'late'])
  })
})
