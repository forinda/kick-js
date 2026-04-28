import 'reflect-metadata'
import { describe, it, expect } from 'vitest'

import {
  Application,
  defineAdapter,
  definePlugin,
  defineContextDecorator,
} from '../src/index'

const tenantContrib = defineContextDecorator({
  key: 'tenant',
  resolve: () => ({ id: 't1' }),
})
const userContrib = defineContextDecorator({
  key: 'user',
  resolve: () => ({ id: 'u1' }),
})
const analyticsContrib = defineContextDecorator({
  key: 'analytics',
  resolve: () => ({ enabled: true }),
})

const TenantAdapter = defineAdapter({
  name: 'TenantAdapter',
  build: () => ({
    contributors: () => [tenantContrib.registration],
  }),
})

const AuthPlugin = definePlugin({
  name: 'AuthPlugin',
  build: () => ({
    contributors: () => [userContrib.registration],
  }),
})

describe('Application.getContributors() — devtools introspection', () => {
  it('returns adapter contributors with adapter source label', () => {
    const app = new Application({ modules: [], adapters: [TenantAdapter()] })
    const contributors = app.getContributors()
    expect(contributors).toHaveLength(1)
    expect(contributors[0].key).toBe('tenant')
    expect(contributors[0].source).toBe('adapter')
    expect(contributors[0].label).toBe('TenantAdapter')
  })

  it('returns plugin contributors with plugin source label', () => {
    const app = new Application({ modules: [], plugins: [AuthPlugin()] })
    const contributors = app.getContributors()
    expect(contributors).toHaveLength(1)
    expect(contributors[0].key).toBe('user')
    expect(contributors[0].source).toBe('plugin')
    expect(contributors[0].label).toBe('AuthPlugin')
  })

  it('returns global contributors with global source label', () => {
    const app = new Application({
      modules: [],
      contributors: [analyticsContrib.registration],
    })
    const contributors = app.getContributors()
    expect(contributors).toHaveLength(1)
    expect(contributors[0].key).toBe('analytics')
    expect(contributors[0].source).toBe('global')
    expect(contributors[0].label).toBe('bootstrap')
  })

  it('combines all three sources, preserving distinct labels', () => {
    const app = new Application({
      modules: [],
      adapters: [TenantAdapter()],
      plugins: [AuthPlugin()],
      contributors: [analyticsContrib.registration],
    })
    const list = app.getContributors()
    expect(list.map((c) => c.key).sort()).toEqual(['analytics', 'tenant', 'user'])
    expect(list.find((c) => c.key === 'tenant')?.label).toBe('TenantAdapter')
    expect(list.find((c) => c.key === 'user')?.label).toBe('AuthPlugin')
    expect(list.find((c) => c.key === 'analytics')?.label).toBe('bootstrap')
  })

  it('returns empty array when no contributors are registered', () => {
    const app = new Application({ modules: [] })
    expect(app.getContributors()).toEqual([])
  })
})
