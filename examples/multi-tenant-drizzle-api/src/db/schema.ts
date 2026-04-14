/**
 * Shared schema used by all tenant databases.
 * The provider DB also has the `tenants` table for the registry.
 */

export const PROVIDER_TENANT = 'provider'

/**
 * Tenant record — stored in the provider database only.
 * Each row maps a subdomain to a database connection.
 */
export interface TenantRecord {
  id: string
  name: string
  subdomain: string
  dbUrl: string
}

/**
 * User — exists in every tenant database.
 */
export interface User {
  id: string
  email: string
  name: string
}

/**
 * Project — exists in every tenant database.
 */
export interface Project {
  id: string
  title: string
  description: string
  createdAt: Date
}

/**
 * In-memory store simulating the provider database.
 * Replace with real Drizzle pgTable definitions and a PostgreSQL connection
 * in a production app.
 */
export const providerTenants: TenantRecord[] = [
  {
    id: 'tenant-acme',
    name: 'Acme Corp',
    subdomain: 'acme',
    dbUrl: 'postgresql://localhost:5432/tenant_acme',
  },
  {
    id: 'tenant-globex',
    name: 'Globex Inc',
    subdomain: 'globex',
    dbUrl: 'postgresql://localhost:5432/tenant_globex',
  },
]
