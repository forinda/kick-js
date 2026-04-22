import { Logger, Scope, defineAdapter, type AdapterMiddleware } from '@forinda/kickjs'
import type { Request, Response, NextFunction } from 'express'
import { TENANT_CONTEXT, type TenantInfo, type MultiTenantOptions } from './types'
import { tenantStorage, getCurrentTenant } from './tenant.context'

const log = Logger.for('MultiTenant')

/**
 * Multi-tenancy adapter for KickJS.
 *
 * Resolves the tenant from each request and makes it available via DI
 * (`@Inject(TENANT_CONTEXT)`) and `req.tenant`.
 *
 * @example
 * ```ts
 * import { TenantAdapter, TENANT_CONTEXT } from '@forinda/kickjs-multi-tenant'
 *
 * bootstrap({
 *   modules,
 *   adapters: [
 *     TenantAdapter({
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
 *
 * Multiple shards or independent tenant pipelines? Use `.scoped()` for
 * a per-shard instance — each one gets its own `name` (e.g.
 * `TenantAdapter:eu`) so `dependsOn` lookups stay unambiguous:
 *
 * ```ts
 * adapters: [
 *   TenantAdapter.scoped('eu', { strategy: 'header', headerName: 'x-eu-tenant' }),
 *   TenantAdapter.scoped('us', { strategy: 'header', headerName: 'x-us-tenant' }),
 * ]
 * ```
 */
export const TenantAdapter = defineAdapter<MultiTenantOptions>({
  name: 'TenantAdapter',
  defaults: {
    strategy: 'header',
    required: true,
    headerName: 'x-tenant-id',
    queryParam: 'tenantId',
  },
  build: (options) => ({
    middleware(): AdapterMiddleware[] {
      return [
        {
          handler: async (req: Request, res: Response, next: NextFunction) => {
            if (options.excludeRoutes?.some((r) => req.path.startsWith(r))) {
              return next()
            }

            const tenant = await resolveTenant(req, options)

            if (!tenant) {
              if (options.required) {
                res
                  .status(403)
                  .json({ message: 'Tenant not found. Provide a valid tenant identifier.' })
                return
              }
              return next()
            }

            ;(req as unknown as { tenant: TenantInfo }).tenant = tenant

            if (options.onTenantResolved) {
              await options.onTenantResolved(tenant, req)
            }

            // Wrap the rest of the request in AsyncLocalStorage so
            // @Inject(TENANT_CONTEXT) and getCurrentTenant() return the
            // correct tenant for this request.
            tenantStorage.run(tenant, () => next())
          },
          phase: 'beforeGlobal',
        },
      ]
    },

    beforeStart({ container }) {
      // TRANSIENT so each resolution reads from AsyncLocalStorage.
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
        `Tenant resolution: ${typeof options.strategy === 'function' ? 'custom' : options.strategy}`,
      )
    },
  }),
})

async function resolveTenant(
  req: Request,
  options: MultiTenantOptions,
): Promise<TenantInfo | null> {
  const strategy = options.strategy

  if (typeof strategy === 'function') {
    return strategy(req)
  }

  switch (strategy) {
    case 'header': {
      const tenantId = req.get(options.headerName!)
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
      const tenantId = req.query[options.queryParam!] as string
      return tenantId ? { id: tenantId } : null
    }
    default:
      return null
  }
}
