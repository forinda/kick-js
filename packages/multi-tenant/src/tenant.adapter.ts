import {
  Logger,
  type AppAdapter,
  type AdapterContext,
  type AdapterMiddleware,
  Scope,
} from '@forinda/kickjs'
import type { Request, Response, NextFunction } from 'express'
import {
  TENANT_CONTEXT,
  type TenantInfo,
  type MultiTenantOptions,
  type TenantResolutionStrategy,
} from './types'
import { tenantStorage, getCurrentTenant } from './tenant.context'

const log = Logger.for('MultiTenant')

/**
 * Multi-tenancy adapter for KickJS.
 *
 * Resolves the tenant from each request and makes it available
 * via DI (`@Inject(TENANT_CONTEXT)`) and `req.tenant`.
 *
 * @example
 * ```ts
 * import { TenantAdapter, TENANT_CONTEXT } from '@forinda/kickjs-multi-tenant'
 *
 * bootstrap({
 *   modules,
 *   adapters: [
 *     new TenantAdapter({
 *       strategy: 'header',
 *       onTenantResolved: async (tenant) => {
 *         // Load tenant config from DB, validate, etc.
 *       },
 *     }),
 *   ],
 * })
 *
 * // In a service:
 * @Service()
 * class UserService {
 *   constructor(@Inject(TENANT_CONTEXT) private tenant: TenantInfo) {}
 * }
 * ```
 */
export class TenantAdapter implements AppAdapter {
  name = 'TenantAdapter'
  private options: Required<
    Pick<MultiTenantOptions, 'strategy' | 'required' | 'headerName' | 'queryParam'>
  > &
    MultiTenantOptions

  constructor(options: MultiTenantOptions = {}) {
    this.options = {
      strategy: options.strategy ?? 'header',
      required: options.required ?? true,
      headerName: options.headerName ?? 'x-tenant-id',
      queryParam: options.queryParam ?? 'tenantId',
      ...options,
    }
  }

  middleware(): AdapterMiddleware[] {
    return [
      {
        handler: async (req: Request, res: Response, next: NextFunction) => {
          // Skip excluded routes
          if (this.options.excludeRoutes?.some((r) => req.path.startsWith(r))) {
            return next()
          }

          const tenant = await this.resolveTenant(req)

          if (!tenant) {
            if (this.options.required) {
              res
                .status(403)
                .json({ message: 'Tenant not found. Provide a valid tenant identifier.' })
              return
            }
            return next()
          }

          // Attach to request
          ;(req as any).tenant = tenant

          // Call hook
          if (this.options.onTenantResolved) {
            await this.options.onTenantResolved(tenant, req)
          }

          // Wrap the rest of the request in AsyncLocalStorage so
          // @Inject(TENANT_CONTEXT) and getCurrentTenant() return
          // the correct tenant for this request.
          tenantStorage.run(tenant, () => next())
        },
        phase: 'beforeGlobal',
      },
    ]
  }

  beforeStart({ container }: AdapterContext): void {
    // Register as TRANSIENT so each resolution reads from AsyncLocalStorage
    container.registerFactory(
      TENANT_CONTEXT,
      () => {
        const tenant = getCurrentTenant()
        if (!tenant) {
          throw new Error(
            'TENANT_CONTEXT resolved outside request scope. ' +
              'Ensure TenantAdapter middleware is active and the code runs within a request.',
          )
        }
        return tenant
      },
      Scope.TRANSIENT,
    )
    log.info(
      `Tenant resolution: ${typeof this.options.strategy === 'function' ? 'custom' : this.options.strategy}`,
    )
  }

  private async resolveTenant(req: Request): Promise<TenantInfo | null> {
    const strategy = this.options.strategy

    if (typeof strategy === 'function') {
      return strategy(req)
    }

    switch (strategy) {
      case 'header': {
        const tenantId = req.get(this.options.headerName)
        return tenantId ? { id: tenantId } : null
      }
      case 'subdomain': {
        const host = req.hostname
        const parts = host.split('.')
        if (parts.length >= 3) {
          return { id: parts[0] }
        }
        return null
      }
      case 'path': {
        const segments = req.path.split('/').filter(Boolean)
        if (segments.length > 0) {
          return { id: segments[0] }
        }
        return null
      }
      case 'query': {
        const tenantId = req.query[this.options.queryParam] as string
        return tenantId ? { id: tenantId } : null
      }
      default:
        return null
    }
  }
}
