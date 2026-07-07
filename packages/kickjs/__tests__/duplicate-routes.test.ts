import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import * as h3v2 from 'h3-v2'

import { Application, Container, KickError } from '../src/index'
import { createWebApp } from '../src/web'
import { Controller, Get, Post } from '../src/core/decorators'
import { defineModule } from '../src/core/define-module'
import type { RequestContext } from '../src/http/context'

/**
 * KICK006 — duplicate verb + mounted path fails at boot on both the node
 * (Application.setup) and web (createWebApp) mount paths. Without this the
 * engine silently dispatches one handler while typegen/the typed client may
 * describe the other.
 */

beforeEach(() => {
  Container.reset()
})

function taskModule(path = '/tasks') {
  @Controller()
  class TasksController {
    @Get('/:id')
    async get(ctx: RequestContext): Promise<void> {
      ctx.json({ id: ctx.params.id })
    }
  }
  return defineModule({
    name: `TasksModule-${path}`,
    build: () => ({ routes: () => ({ path, controller: TasksController }) }),
  })()
}

function expectKick006(fn: () => unknown | Promise<unknown>) {
  return expect(async () => await fn()).rejects.toSatisfy(
    (e: unknown) =>
      e instanceof KickError && (e as KickError & { code: string }).code === 'KICK006',
  )
}

describe('duplicate routes — Application (node)', () => {
  it('throws KICK006 when one controller registers the same verb+path twice', async () => {
    @Controller()
    class DupController {
      @Get('/items')
      async a(ctx: RequestContext): Promise<void> {
        ctx.json({ via: 'a' })
      }
      @Get('/items')
      async b(ctx: RequestContext): Promise<void> {
        ctx.json({ via: 'b' })
      }
    }
    const mod = defineModule({
      name: 'DupModule',
      build: () => ({ routes: () => ({ path: '/dup', controller: DupController }) }),
    })()
    const app = new Application({ modules: [mod] })
    const err = await app.setup().then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(KickError)
    expect((err as KickError & { code: string }).code).toBe('KICK006')
    // Owner granularity: both conflicting handlers are named, not just the class.
    expect((err as Error).message).toContain('DupController.a')
    expect((err as Error).message).toContain('DupController.b')
  })

  it('throws KICK006 across modules mounted on the same path', async () => {
    const app = new Application({ modules: [taskModule(), taskModule()] })
    await expectKick006(() => app.setup())
  })

  it('treats differing param names as the same route (/:id vs /:taskId)', async () => {
    @Controller()
    class ParamController {
      @Get('/:id')
      async byId(ctx: RequestContext): Promise<void> {
        ctx.json({})
      }
      @Get('/:taskId')
      async byTaskId(ctx: RequestContext): Promise<void> {
        ctx.json({})
      }
    }
    const mod = defineModule({
      name: 'ParamModule',
      build: () => ({ routes: () => ({ path: '/p', controller: ParamController }) }),
    })()
    const app = new Application({ modules: [mod] })
    await expectKick006(() => app.setup())
  })

  it('same path under different verbs or versions is fine', async () => {
    @Controller()
    class OkController {
      @Get('/items')
      async list(ctx: RequestContext): Promise<void> {
        ctx.json([])
      }
      @Post('/items')
      async create(ctx: RequestContext): Promise<void> {
        ctx.created({})
      }
    }
    const v1 = defineModule({
      name: 'V1',
      build: () => ({ routes: () => ({ path: '/ok', controller: OkController }) }),
    })()
    const v2 = defineModule({
      name: 'V2',
      build: () => ({ routes: () => ({ path: '/ok', controller: OkController, version: 2 }) }),
    })()
    const app = new Application({ modules: [v1, v2] })
    await expect(app.setup()).resolves.not.toThrow()
  })
})

describe('duplicate routes — createWebApp (web)', () => {
  it('throws KICK006 at build time for cross-module duplicates', () => {
    try {
      createWebApp({ h3: h3v2, modules: [taskModule(), taskModule()] })
      expect.unreachable('expected createWebApp to throw')
    } catch (e) {
      expect(e).toBeInstanceOf(KickError)
      expect((e as KickError & { code: string }).code).toBe('KICK006')
    }
  })

  it('boots and serves when routes are unique', async () => {
    const app = createWebApp({ h3: h3v2, modules: [taskModule()] })
    const res = await app.fetch(new Request('http://x/api/v1/tasks/7'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: '7' })
  })
})
