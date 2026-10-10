/**
 * Several AI adapters side by side: `AiAdapter.scoped(name, …)` registers
 * under that scope's tokens, so each resolves separately, and AI_ADAPTER /
 * AI_PROVIDER stay the unscoped adapter's.
 */
import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Application, Container, Controller, Post, type RequestContext } from '@forinda/kickjs'
import {
  AI_ADAPTER,
  AI_PROVIDER,
  AiAdapter,
  AiTool,
  aiAdapterToken,
  aiProviderToken,
  type AiProvider,
} from '@forinda/kickjs-ai'

const providerNamed = (name: string): AiProvider => ({
  name,
  chat: async () => ({ content: name }),
  // eslint-disable-next-line require-yield
  async *stream() {
    throw new Error('not used')
  },
  embed: async () => [],
})

const apps: Application[] = []
beforeEach(() => Container.reset())
afterEach(async () => {
  while (apps.length) await apps.pop()!.shutdown()
})

@Controller()
class DeskController {
  @AiTool({ description: 'Open a ticket' })
  @Post('/tickets')
  ticket(ctx: RequestContext) {
    ctx.json({})
  }

  @AiTool({ description: 'Refund an invoice' })
  @Post('/refunds')
  refund(ctx: RequestContext) {
    ctx.json({})
  }
}

async function boot(adapters: ReturnType<typeof AiAdapter>[]) {
  const modules = [{ routes: () => ({ path: '/desk', controller: DeskController }) }]
  const app = new Application({ port: 0, modules, adapters } as never)
  await app.start()
  apps.push(app)
  return Container.getInstance()
}

describe('AiAdapter.scoped()', () => {
  it('resolves each scoped adapter and its provider by its own token', async () => {
    const container = await boot([
      AiAdapter({ provider: providerNamed('default') }),
      AiAdapter.scoped('support', {
        provider: providerNamed('claude'),
        hideWhen: ({ route }) => route?.handlerName === 'refund',
      }),
      AiAdapter.scoped('billing', {
        provider: providerNamed('gpt'),
        hideWhen: ({ route }) => route?.handlerName === 'ticket',
      }),
    ])

    expect(container.resolve(AI_PROVIDER).name).toBe('default')
    expect(container.resolve(AI_ADAPTER).getProvider().name).toBe('default')

    const support = container.resolve(aiAdapterToken('support'))
    const billing = container.resolve(aiAdapterToken('billing'))
    expect(support.getProvider().name).toBe('claude')
    expect(container.resolve(aiProviderToken('billing')).name).toBe('gpt')
    // Each exposes only its own tools.
    expect(support.getTools().map((t) => t.name)).toEqual(['DeskController_ticket'])
    expect(billing.getTools().map((t) => t.name)).toEqual(['DeskController_refund'])
    // Providers registered on one don't leak into the other.
    support.registerProvider('local', providerNamed('local'))
    expect(() => billing.getProvider('local')).toThrow(/no provider registered as "local"/)
  })

  it('never registers a scoped adapter as AI_ADAPTER', async () => {
    const container = await boot([AiAdapter.scoped('only', { provider: providerNamed('x') })])
    const only = container.resolve(aiAdapterToken('only'))
    expect(only.getProvider().name).toBe('x')
    // An earlier test's AI_ADAPTER may be replayed after Container.reset()
    // (registrations survive HMR); it must not be this adapter.
    if (container.has(AI_ADAPTER)) expect(container.resolve(AI_ADAPTER)).not.toBe(only)
  })

  it('hands out the same token for a scope every time', () => {
    expect(aiAdapterToken('support')).toBe(aiAdapterToken('support'))
    expect(aiAdapterToken('support')).not.toBe(aiAdapterToken('billing'))
    expect(aiProviderToken('support')).not.toBe(aiAdapterToken('support'))
  })
})
