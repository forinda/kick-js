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
    const config = this.config

    if (!Object.getOwnPropertyDescriptor(RequestContext.prototype, 'inertia')) {
      Object.defineProperty(RequestContext.prototype, 'inertia', {
        get(this: InstanceType<typeof RequestContext>) {
          // Lazily create the Inertia instance on first access per request.
          // The middleware sets it early if it can, but if RequestContext is
          // created after middleware runs (router-builder), we create it here.
          let inertia = (this as any).get('inertia') as Inertia | undefined
          if (!inertia) {
            inertia = new Inertia(this, config)
            ;(this as any).set('inertia', inertia)

            // Apply config-level shared data
            if (config.share) {
              const shared = config.share(this)
              if (
                shared &&
                typeof shared === 'object' &&
                typeof (shared as any).then !== 'function'
              ) {
                inertia.share(shared as Record<string, any>)
              }
            }
          }
          return inertia
        },
        configurable: true,
      })
    }
  }

  async onHealthCheck(): Promise<{ name: string; status: 'up' | 'down' }> {
    return { name: 'InertiaAdapter', status: 'up' }
  }
}
