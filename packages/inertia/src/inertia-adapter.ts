import type { AppAdapter, AdapterContext, AdapterMiddleware } from '@forinda/kickjs'
import { RequestContext } from '@forinda/kickjs'
import { createInertiaMiddleware } from './inertia-middleware'
import type { InertiaConfig } from './types'
import { Inertia } from './inertia'

export class InertiaAdapter implements AppAdapter {
  name = 'InertiaAdapter'

  constructor(private config: InertiaConfig) {}

  middleware(): AdapterMiddleware[] {
    return [
      {
        handler: createInertiaMiddleware(this.config),
        phase: 'beforeRoutes',
      },
    ]
  }

  beforeMount(_ctx: AdapterContext): void {
    if (!Object.getOwnPropertyDescriptor(RequestContext.prototype, 'inertia')) {
      Object.defineProperty(RequestContext.prototype, 'inertia', {
        get(this: InstanceType<typeof RequestContext>) {
          return (this as any).get('inertia') as Inertia
        },
        configurable: true,
      })
    }
  }

  async onHealthCheck(): Promise<{ name: string; status: 'up' | 'down' }> {
    return { name: 'InertiaAdapter', status: 'up' }
  }
}
