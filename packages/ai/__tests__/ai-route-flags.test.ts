/**
 * Route flags decide which routes AiAdapter exposes as tools: `exposeWhen`,
 * `hideWhen`, and tool options carried by a flag's value.
 */
import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  Application,
  Container,
  Controller,
  Get,
  Post,
  defineRouteFlag,
  type RequestContext,
} from '@forinda/kickjs'
import { AiAdapter, AiTool, type AiProvider, type AiToolOptions } from '@forinda/kickjs-ai'

const Tool = defineRouteFlag<Partial<AiToolOptions>>('ai.tool')

const provider: AiProvider = {
  name: 'unused',
  chat: async () => ({ content: '' }),
  // eslint-disable-next-line require-yield
  async *stream() {
    throw new Error('not used')
  },
  embed: async () => [],
}

const apps: Application[] = []

beforeEach(() => {
  Container.reset()
})
afterEach(async () => {
  while (apps.length) await apps.pop()!.shutdown()
})

async function toolsFor(adapter: ReturnType<typeof AiAdapter>) {
  @Tool({ description: 'Look up orders' })
  @Controller()
  class OrdersController {
    @Get('/')
    list(ctx: RequestContext) {
      ctx.json([])
    }

    @AiTool({ description: 'From the decorator' })
    @Post('/')
    create(ctx: RequestContext) {
      ctx.json({}, 201)
    }
  }

  @Controller()
  class AdminController {
    @AiTool({ description: 'Wipe everything' })
    @Post('/wipe')
    wipe(ctx: RequestContext) {
      ctx.json({})
    }
  }

  const modules = [
    { routes: () => ({ path: '/orders', controller: OrdersController }) },
    { routes: () => ({ path: '/admin', controller: AdminController, flags: ['ai.hidden'] }) },
  ]
  const app = new Application({ port: 0, modules, adapters: [adapter] } as never)
  await app.start()
  apps.push(app)
  return Object.fromEntries(adapter.getTools().map((t) => [t.name, t]))
}

describe('AiAdapter — route flags', () => {
  it('exposes flagged routes with the flag description; @AiTool wins on its method', async () => {
    const tools = await toolsFor(AiAdapter({ provider, exposeWhen: 'ai.tool' }))
    expect(tools.OrdersController_list?.description).toBe('Look up orders')
    expect(tools.OrdersController_create?.description).toBe('From the decorator')
  })

  it('hideWhen on a module mount wins over @AiTool', async () => {
    const tools = await toolsFor(AiAdapter({ provider, hideWhen: 'ai.hidden' }))
    expect(tools.AdminController_wipe).toBeUndefined()
    expect(tools.OrdersController_create).toBeDefined()
  })

  it('flags alone expose nothing without exposeWhen', async () => {
    const tools = await toolsFor(AiAdapter({ provider }))
    expect(tools.OrdersController_list).toBeUndefined()
    expect(tools.AdminController_wipe).toBeDefined()
  })

  it('describes a flagged route whose flag carries no description', async () => {
    const tools = await toolsFor(
      AiAdapter({ provider, exposeWhen: ({ route }) => route?.handlerName === 'list' }),
    )
    expect(tools.OrdersController_list?.description).toBe(
      'GET /api/v1/orders (OrdersController.list)',
    )
  })
})

describe('AiAdapter — flag test validation', () => {
  it('does not run predicates when the adapter is created', () => {
    // A predicate may assume a route; creation must not call it without one.
    expect(() =>
      AiAdapter({ provider, exposeWhen: ({ route }) => route!.method === 'GET' }),
    ).not.toThrow()
    expect(() => AiAdapter({ provider, hideWhen: ['ai.hidden', '!ai.tool'] as never })).toThrow(
      'mixes polarities',
    )
  })
})
