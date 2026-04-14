import { describe, it, expect } from 'vitest'
import { tenantStorage, getCurrentTenant } from '../src/tenant.context'

describe('Tenant AsyncLocalStorage', () => {
  it('getCurrentTenant returns undefined outside request scope', () => {
    expect(getCurrentTenant()).toBeUndefined()
  })

  it('getCurrentTenant returns the tenant inside tenantStorage.run()', () => {
    const tenant = { id: 'acme', name: 'Acme Corp' }
    tenantStorage.run(tenant, () => {
      expect(getCurrentTenant()).toEqual(tenant)
    })
  })

  it('concurrent runs get different tenants', async () => {
    const results: string[] = []

    await Promise.all([
      new Promise<void>((resolve) => {
        tenantStorage.run({ id: 'tenant-a' }, () => {
          setTimeout(() => {
            results.push(getCurrentTenant()!.id)
            resolve()
          }, 10)
        })
      }),
      new Promise<void>((resolve) => {
        tenantStorage.run({ id: 'tenant-b' }, () => {
          setTimeout(() => {
            results.push(getCurrentTenant()!.id)
            resolve()
          }, 5)
        })
      }),
    ])

    expect(results).toContain('tenant-a')
    expect(results).toContain('tenant-b')
  })

  it('returns undefined after run completes', () => {
    tenantStorage.run({ id: 'temp' }, () => {
      expect(getCurrentTenant()?.id).toBe('temp')
    })
    expect(getCurrentTenant()).toBeUndefined()
  })
})
