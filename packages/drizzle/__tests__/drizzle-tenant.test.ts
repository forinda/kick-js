import { describe, it, expect, vi } from 'vitest'
import { DrizzleTenantAdapter } from '../src/drizzle-tenant.adapter'

// Simulated typed DB — in production this would be NodePgDatabase<typeof schema>
interface MockDb {
  tenantId: string
}

function createMockDb(tenantId: string): MockDb {
  return { tenantId }
}

describe('DrizzleTenantAdapter', () => {
  describe('getDb()', () => {
    it('returns provider DB when no tenantId', async () => {
      const providerDb = createMockDb('provider')
      const adapter = new DrizzleTenantAdapter({
        providerDb,
        tenantFactory: (id) => createMockDb(id),
      })

      const db = await adapter.getDb()
      expect(db.tenantId).toBe('provider')
    })

    it('returns provider DB when tenantId is null', async () => {
      const providerDb = createMockDb('provider')
      const adapter = new DrizzleTenantAdapter({
        providerDb,
        tenantFactory: (id) => createMockDb(id),
      })

      const db = await adapter.getDb(null)
      expect(db.tenantId).toBe('provider')
    })

    it('creates tenant DB on first access', async () => {
      const factory = vi.fn((id: string) => createMockDb(id))
      const adapter = new DrizzleTenantAdapter({
        providerDb: createMockDb('provider'),
        tenantFactory: factory,
      })

      const db = await adapter.getDb('acme')
      expect(db.tenantId).toBe('acme')
      expect(factory).toHaveBeenCalledWith('acme')
      expect(factory).toHaveBeenCalledTimes(1)
    })

    it('caches tenant DB on subsequent access', async () => {
      const factory = vi.fn((id: string) => createMockDb(id))
      const adapter = new DrizzleTenantAdapter({
        providerDb: createMockDb('provider'),
        tenantFactory: factory,
      })

      const db1 = await adapter.getDb('acme')
      const db2 = await adapter.getDb('acme')
      expect(db1).toBe(db2)
      expect(factory).toHaveBeenCalledTimes(1)
    })

    it('creates separate connections per tenant', async () => {
      const adapter = new DrizzleTenantAdapter({
        providerDb: createMockDb('provider'),
        tenantFactory: (id) => createMockDb(id),
      })

      const acme = await adapter.getDb('acme')
      const globex = await adapter.getDb('globex')

      expect(acme.tenantId).toBe('acme')
      expect(globex.tenantId).toBe('globex')
      expect(acme).not.toBe(globex)
      expect(adapter.connectionCount).toBe(2)
    })

    it('supports async tenantFactory', async () => {
      const adapter = new DrizzleTenantAdapter({
        providerDb: createMockDb('provider'),
        tenantFactory: async (id) => {
          // Simulate async DB lookup
          return createMockDb(id)
        },
      })

      const db = await adapter.getDb('async-tenant')
      expect(db.tenantId).toBe('async-tenant')
    })
  })

  describe('shutdown()', () => {
    it('calls onTenantShutdown for each cached connection', async () => {
      const onTenantShutdown = vi.fn()
      const adapter = new DrizzleTenantAdapter({
        providerDb: createMockDb('provider'),
        tenantFactory: (id) => createMockDb(id),
        onTenantShutdown,
      })

      await adapter.getDb('acme')
      await adapter.getDb('globex')
      await adapter.shutdown()

      expect(onTenantShutdown).toHaveBeenCalledTimes(2)
      expect(onTenantShutdown).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'acme' }),
        'acme',
      )
      expect(onTenantShutdown).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'globex' }),
        'globex',
      )
      expect(adapter.connectionCount).toBe(0)
    })

    it('clears connections even without onTenantShutdown', async () => {
      const adapter = new DrizzleTenantAdapter({
        providerDb: createMockDb('provider'),
        tenantFactory: (id) => createMockDb(id),
      })

      await adapter.getDb('acme')
      await adapter.shutdown()
      expect(adapter.connectionCount).toBe(0)
    })
  })

  describe('connectionCount', () => {
    it('starts at 0', () => {
      const adapter = new DrizzleTenantAdapter({
        providerDb: createMockDb('provider'),
        tenantFactory: (id) => createMockDb(id),
      })

      expect(adapter.connectionCount).toBe(0)
    })
  })
})
