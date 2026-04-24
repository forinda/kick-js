import 'reflect-metadata'
import './config'
import express from 'express'
import { bootstrap } from '@forinda/kickjs'
import { AuthAdapter, JwtStrategy } from '@forinda/kickjs-auth'
import { modules } from './modules'
import { LoadTenant } from './contributors/tenant.context'
import { TenantDbPlugin } from './plugins/tenant-db.plugin'

/**
 * Multi-tenant Drizzle example (BYO recipe — no `@forinda/kickjs-multi-tenant`).
 *
 * Flow:
 *   1. `LoadTenant` (Context Contributor) resolves tenant from subdomain
 *      and writes it to `ctx.get('tenant')` for every request.
 *   2. `TenantDbPlugin` registers `TENANT_DB` as a REQUEST-scoped factory
 *      that returns the typed DB for the active tenant.
 *   3. AuthAdapter authenticates the request (JWT).
 *   4. Controller uses TenantDbService (or `@Inject(TENANT_DB)`) to access
 *      the typed DB for the current tenant.
 *
 * See docs/guide/multi-tenancy.md for the full recipe.
 */
export const app = await bootstrap({
  modules,
  middleware: [express.json()],
  contributors: [LoadTenant.registration],
  plugins: [TenantDbPlugin()],
  adapters: [
    AuthAdapter({
      strategies: [
        JwtStrategy({
          secret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
          mapPayload: (p) => ({ id: p.sub, email: p.email, roles: p.roles ?? ['user'] }),
        }),
      ],
      defaultPolicy: 'open', // Open for demo — use 'protected' in production
    }),
  ],
})
