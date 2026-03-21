import { describe, it, expect, beforeEach } from 'vitest'
import 'reflect-metadata'
import {
  Container,
  Scope,
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Service,
  Autowired,
  Middleware,
  type MiddlewareHandler,
} from '@forinda/kickjs-core'
import { buildRoutes, getControllerPath, RequestContext } from '@forinda/kickjs-http'
import { z } from 'zod'

/**
 * buildRoutes() calls container.resolve(controllerClass). Because @Controller
 * decorators fire at class-definition time against the *current* container,
 * and we call Container.reset() in beforeEach, we must re-register controllers
 * manually for each test.
 */
function registerClass(cls: any, container: Container) {
  if (!container.has(cls)) {
    container.register(cls, cls, Scope.SINGLETON)
  }
}

describe('Router Builder', () => {
  beforeEach(() => {
    Container.reset()
  })

  it('getControllerPath returns the path from @Controller', () => {
    @Controller('/users')
    class UserCtrl {}
    expect(getControllerPath(UserCtrl)).toBe('/users')
  })

  it('getControllerPath defaults to / when no path given', () => {
    @Controller()
    class RootCtrl {}
    expect(getControllerPath(RootCtrl)).toBe('/')
  })

  it('buildRoutes returns an Express Router', () => {
    @Controller('/items')
    class ItemCtrl {
      @Get('/')
      list(ctx: RequestContext) {
        ctx.json([])
      }
    }

    const container = Container.getInstance()
    registerClass(ItemCtrl, container)
    const router = buildRoutes(ItemCtrl)
    expect(router).toBeDefined()
    expect(typeof router).toBe('function')
  })

  it('buildRoutes registers GET, POST, PUT, DELETE, PATCH routes', () => {
    @Controller()
    class CrudCtrl {
      @Get('/') list(ctx: RequestContext) { ctx.json([]) }
      @Post('/') create(ctx: RequestContext) { ctx.created({}) }
      @Put('/:id') update(ctx: RequestContext) { ctx.json({}) }
      @Delete('/:id') remove(ctx: RequestContext) { ctx.noContent() }
      @Patch('/:id') patch(ctx: RequestContext) { ctx.json({}) }
    }

    const container = Container.getInstance()
    registerClass(CrudCtrl, container)
    const router = buildRoutes(CrudCtrl)

    const stack = (router as any).stack || []
    const methods = stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => Object.keys(layer.route.methods))
      .flat()

    expect(methods).toContain('get')
    expect(methods).toContain('post')
    expect(methods).toContain('put')
    expect(methods).toContain('delete')
    expect(methods).toContain('patch')
  })

  it('buildRoutes injects @Autowired dependencies into controller', () => {
    @Service()
    class GreetService {
      greet() { return 'hello' }
    }

    @Controller()
    class GreetCtrl {
      @Autowired() svc!: GreetService
      @Get('/') handle(ctx: RequestContext) { ctx.json({ msg: this.svc.greet() }) }
    }

    const container = Container.getInstance()
    registerClass(GreetService, container)
    registerClass(GreetCtrl, container)
    buildRoutes(GreetCtrl)

    const ctrl = container.resolve(GreetCtrl)
    expect(ctrl.svc).toBeInstanceOf(GreetService)
    expect(ctrl.svc.greet()).toBe('hello')
  })

  it('buildRoutes applies validation middleware for routes with schemas', () => {
    const createSchema = z.object({ name: z.string() })

    @Controller()
    class ValidatedCtrl {
      @Post('/', { body: createSchema })
      create(ctx: RequestContext) { ctx.created(ctx.body) }
    }

    const container = Container.getInstance()
    registerClass(ValidatedCtrl, container)
    const router = buildRoutes(ValidatedCtrl)

    const stack = (router as any).stack || []
    const postRoute = stack.find(
      (layer: any) => layer.route && layer.route.methods.post,
    )
    expect(postRoute).toBeDefined()
    // Validation middleware + main handler = at least 2
    expect(postRoute.route.stack.length).toBeGreaterThanOrEqual(2)
  })

  it('buildRoutes applies class-level and method-level middleware', () => {
    const classMw: MiddlewareHandler = (_ctx, next) => { next() }
    const methodMw: MiddlewareHandler = (_ctx, next) => { next() }

    @Controller()
    @Middleware(classMw)
    class MwCtrl {
      @Get('/')
      @Middleware(methodMw)
      handle(ctx: RequestContext) { ctx.json({}) }
    }

    const container = Container.getInstance()
    registerClass(MwCtrl, container)
    const router = buildRoutes(MwCtrl)

    const stack = (router as any).stack || []
    const getRoute = stack.find(
      (layer: any) => layer.route && layer.route.methods.get,
    )
    // class middleware + method middleware + handler = at least 3
    expect(getRoute.route.stack.length).toBeGreaterThanOrEqual(3)
  })
})
