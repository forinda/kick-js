/**
 * Route flags decide which routes McpAdapter exposes: `exposeWhen`, `hideWhen`,
 * and tool options carried by a flag's value — on methods, controllers and
 * module mounts.
 */
import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  Application,
  Container,
  Controller,
  Delete,
  Get,
  Post,
  defineRouteFlag,
  type RequestContext,
} from '@forinda/kickjs'
import { McpAdapter, McpTool, type McpToolOptions } from '@forinda/kickjs-mcp'

const Tool = defineRouteFlag<Partial<McpToolOptions>>('mcp.tool')
const Hidden = defineRouteFlag('mcp.hidden')

const apps: Application[] = []

beforeEach(() => {
  Container.reset()
})
afterEach(async () => {
  while (apps.length) await apps.pop()!.shutdown()
})

function controllers() {
  @Tool({ description: 'Manage webhooks' })
  @Controller()
  class WebhooksController {
    @Get('/')
    list(ctx: RequestContext) {
      ctx.json([])
    }

    @Tool({ description: 'Register a webhook', name: 'register_webhook' })
    @Post('/')
    register(ctx: RequestContext) {
      ctx.json({}, 201)
    }

    @Tool.off
    @Delete('/:id')
    remove(ctx: RequestContext) {
      ctx.json({})
    }

    @McpTool({ description: 'From the decorator' })
    @Get('/stats')
    stats(ctx: RequestContext) {
      ctx.json({})
    }
  }

  @Controller()
  class BillingController {
    @McpTool({ description: 'Charge a card' })
    @Post('/charge')
    charge(ctx: RequestContext) {
      ctx.json({})
    }

    @Get('/')
    invoices(ctx: RequestContext) {
      ctx.json([])
    }
  }

  @Controller()
  class ReportsController {
    @Get('/')
    daily(ctx: RequestContext) {
      ctx.json([])
    }
  }

  @Controller()
  class LegacyController {
    @Hidden
    @McpTool({ description: 'Hidden by its own flag' })
    @Get('/')
    old(ctx: RequestContext) {
      ctx.json([])
    }
  }

  return { WebhooksController, BillingController, ReportsController, LegacyController }
}

async function toolsFor(adapter: ReturnType<typeof McpAdapter>) {
  const c = controllers()
  const modules = [
    { routes: () => ({ path: '/webhooks', controller: c.WebhooksController }) },
    {
      routes: () => ({
        path: '/billing',
        controller: c.BillingController,
        flags: ['mcp.hidden'],
      }),
    },
    {
      routes: () => ({
        path: '/reports',
        controller: c.ReportsController,
        flags: { 'mcp.tool': { description: 'Reports, mounted with a flag' } },
      }),
    },
    { routes: () => ({ path: '/legacy', controller: c.LegacyController }) },
  ]
  const app = new Application({ port: 0, modules, adapters: [adapter] } as never)
  await app.start()
  apps.push(app)
  return Object.fromEntries(adapter.getTools().map((t) => [t.name, t]))
}

describe('McpAdapter — exposeWhen', () => {
  it('exposes routes carrying the flag from a controller, a method or a module mount', async () => {
    const tools = await toolsFor(
      McpAdapter({ name: 't', transport: 'http', exposeWhen: 'mcp.tool', hideWhen: 'mcp.hidden' }),
    )

    expect(tools['WebhooksController.list']?.description).toBe('Manage webhooks')
    expect(tools.register_webhook?.description).toBe('Register a webhook')
    expect(tools['ReportsController.daily']?.description).toBe('Reports, mounted with a flag')
  })

  it('respects .off on a method', async () => {
    const tools = await toolsFor(
      McpAdapter({ name: 't', transport: 'http', exposeWhen: 'mcp.tool' }),
    )
    expect(tools['WebhooksController.remove']).toBeUndefined()
  })

  it('lets @McpTool on the method take precedence over the flag options', async () => {
    const tools = await toolsFor(
      McpAdapter({ name: 't', transport: 'http', exposeWhen: 'mcp.tool' }),
    )
    expect(tools['WebhooksController.stats']?.description).toBe('From the decorator')
  })

  it('accepts a predicate, which carries no options', async () => {
    const tools = await toolsFor(
      McpAdapter({
        name: 't',
        transport: 'http',
        exposeWhen: ({ route }) => route?.path === '/api/v1/billing' && route.method === 'GET',
      }),
    )
    expect(tools['BillingController.invoices']?.description).toBe(
      'GET handler BillingController.invoices',
    )
  })

  it('without exposeWhen, flags alone expose nothing in explicit mode', async () => {
    const tools = await toolsFor(McpAdapter({ name: 't', transport: 'http' }))
    expect(tools['WebhooksController.list']).toBeUndefined()
    expect(tools['ReportsController.daily']).toBeUndefined()
    expect(tools['WebhooksController.stats']).toBeDefined()
  })
})

describe('McpAdapter — hideWhen', () => {
  it('hides a module mount, and a method flag, even with @McpTool', async () => {
    const tools = await toolsFor(
      McpAdapter({ name: 't', transport: 'http', hideWhen: 'mcp.hidden' }),
    )
    expect(tools['BillingController.charge']).toBeUndefined()
    expect(tools['LegacyController.old']).toBeUndefined()
    expect(tools['WebhooksController.stats']).toBeDefined()
  })

  it('wins over auto mode', async () => {
    const tools = await toolsFor(
      McpAdapter({ name: 't', transport: 'http', mode: 'auto', hideWhen: 'mcp.hidden' }),
    )
    expect(Object.keys(tools).some((name) => name.startsWith('BillingController.'))).toBe(false)
    expect(tools['ReportsController.daily']).toBeDefined()
  })

  it('rejects a mixed-polarity list when the adapter is created', () => {
    expect(() => McpAdapter({ name: 't', hideWhen: ['mcp.hidden', '!mcp.tool'] as never })).toThrow(
      'mixes polarities',
    )
  })
})
