import 'reflect-metadata'
import './config'
import express from 'express'
import { bootstrap } from '@forinda/kickjs'
import { TenantAdapter } from '@forinda/kickjs-multi-tenant'
import { AuthAdapter, JwtStrategy } from '@forinda/kickjs-auth'
import { modules } from './modules'
import { findTenantBySubdomain } from './db/tenant-manager'
import { PROVIDER_TENANT } from './db/schema'

/**
 * Multi-tenant Drizzle example.
 *
 * Flow:
 *   1. TenantAdapter resolves tenant from subdomain (*.app.example.com)
 *   2. onTenantResolved looks up tenant in provider DB, initializes connection
 *   3. AuthAdapter authenticates the request (JWT)
 *   4. Controller uses TenantDbService to get the typed DB for current tenant
 */
export const app = await bootstrap({
  modules,
  middleware: [express.json()],
  adapters: [
    new TenantAdapter({
      strategy: 'subdomain',
      required: false,
      onTenantResolved: async (tenant) => {
        const record = findTenantBySubdomain(tenant.id)

        if (!record) {
          // Unknown subdomain — fall back to provider
          tenant.id = PROVIDER_TENANT
          tenant.name = 'Provider (default)'
          return
        }

        tenant.id = record.id
        tenant.name = record.name
        tenant.metadata = { dbUrl: record.dbUrl }
      },
    }),

    new AuthAdapter({
      strategies: [
        new JwtStrategy({
          secret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
          mapPayload: (p) => ({ id: p.sub, email: p.email, roles: p.roles ?? ['user'] }),
        }),
      ],
      defaultPolicy: 'open', // Open for demo — use 'protected' in production
    }),
  ],
})
