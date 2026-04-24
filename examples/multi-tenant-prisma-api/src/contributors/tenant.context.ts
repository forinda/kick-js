import { defineHttpContextDecorator } from '@forinda/kickjs'
import { findTenantBySubdomain } from '../db/tenant-manager'
import { PROVIDER_TENANT } from '../db/schema'

/**
 * Resolved tenant attached to every request as `ctx.get('tenant')`.
 * Mirrors the shape the deprecated `@forinda/kickjs-multi-tenant` adapter
 * exposed via `getCurrentTenant()`.
 */
export interface Tenant {
  id: string
  name: string
  metadata?: { dbUrl?: string }
}

declare module '@forinda/kickjs' {
  interface ContextMeta {
    tenant: Tenant
  }
}

/**
 * Subdomain-based tenant resolution. Reads the leading host label
 * (`acme` from `acme.app.example.com`) and looks it up in the provider
 * registry. Unknown subdomains fall back to the provider tenant — same
 * behaviour as the previous `onTenantResolved` hook with `required: false`.
 */
export const LoadTenant = defineHttpContextDecorator({
  key: 'tenant',
  resolve: (ctx): Tenant => {
    const subdomain = ctx.req.hostname.split('.')[0] ?? ''
    const record = findTenantBySubdomain(subdomain)

    if (!record) {
      return { id: PROVIDER_TENANT, name: 'Provider (default)' }
    }

    return {
      id: record.id,
      name: record.name,
      metadata: { dbUrl: record.dbUrl },
    }
  },
})
