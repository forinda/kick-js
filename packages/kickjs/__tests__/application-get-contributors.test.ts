import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'

import {
  Application,
  Container,
  defineAdapter,
  defineModule,
  definePlugin,
  defineContextDecorator,
} from '../src/index'

beforeEach(() => {
  // Reset the singleton container between tests so adapter / plugin
  // factory registrations from one case don't bleed into the next —
  // standard pattern in this codebase per CLAUDE.md.
  Container.reset()
})

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
    expect(list.map((c) => c.key).toSorted()).toEqual(['analytics', 'tenant', 'user'])
    expect(list.find((c) => c.key === 'tenant')?.label).toBe('TenantAdapter')
    expect(list.find((c) => c.key === 'user')?.label).toBe('AuthPlugin')
    expect(list.find((c) => c.key === 'analytics')?.label).toBe('bootstrap')
  })

  it('returns empty array when no contributors are registered', () => {
    const app = new Application({ modules: [] })
    expect(app.getContributors()).toEqual([])
  })

  it('preserves dependsOn through getContributors() (regression — empty deps in devtools)', () => {
    // A contributor with declared dependsOn must keep that list when
    // it round-trips through getContributors. Adopters reported the
    // devtools Contributors table showing empty deps — silent drop
    // here would mask the bug; assert the array survives.
    const TENANT_CONTRIB = defineContextDecorator({
      key: 'tenant',
      resolve: () => ({ id: 't1' }),
    })
    const PROJECT_CONTRIB = defineContextDecorator({
      key: 'project',
      dependsOn: ['tenant'] as const,
      resolve: () => ({ id: 'p1' }),
    })
    const A = defineAdapter({
      name: 'TenantAdapter',
      build: () => ({ contributors: () => [TENANT_CONTRIB.registration] }),
    })
    const P = definePlugin({
      name: 'ProjectsPlugin',
      build: () => ({ contributors: () => [PROJECT_CONTRIB.registration] }),
    })
    const app = new Application({ modules: [], adapters: [A()], plugins: [P()] })
    const list = app.getContributors()
    const project = list.find((c) => c.key === 'project')
    expect(project).toBeDefined()
    expect(project?.dependsOn).toEqual(['tenant'])
  })

  it('surfaces module-level contributors after setup() with source="module"', async () => {
    // Module-level contributors live on AppModule instances that the
    // Application discards post-bootstrap. Application.setup() retains
    // them in an internal snapshot so devtools can render them — assert
    // the snapshot survives and shows up with source: 'module'.
    const FEATURE_CONTRIB = defineContextDecorator({
      key: 'feature-flag',
      dependsOn: ['tenant'] as const,
      resolve: () => ({ enabled: true }),
    })
    const TENANT_CONTRIB = defineContextDecorator({
      key: 'tenant',
      resolve: () => ({ id: 't1' }),
    })
    const FeatureModule = defineModule({
      name: 'FeatureModule',
      build: () => ({
        contributors: () => [FEATURE_CONTRIB.registration],
        routes: () => null,
      }),
    })
    const TenantSeed = defineAdapter({
      name: 'TenantSeed',
      build: () => ({ contributors: () => [TENANT_CONTRIB.registration] }),
    })
    const app = new Application({ modules: [FeatureModule()], adapters: [TenantSeed()] })
    // Pre-setup: module contributors aren't captured yet.
    expect(app.getContributors().some((c) => c.key === 'feature-flag')).toBe(false)
    await app.setup()
    // Post-setup: feature-flag appears with source='module' and intact deps.
    const list = app.getContributors()
    const featureFlag = list.find((c) => c.key === 'feature-flag')
    expect(featureFlag).toBeDefined()
    expect(featureFlag?.source).toBe('module')
    expect(featureFlag?.dependsOn).toEqual(['tenant'])
  })

  it('clears module contributors on re-setup so re-runs do not accumulate', async () => {
    const CONTRIB = defineContextDecorator({
      key: 'audit',
      resolve: () => ({ on: true }),
    })
    const AuditModule = defineModule({
      name: 'AuditModule',
      build: () => ({
        contributors: () => [CONTRIB.registration],
        routes: () => null,
      }),
    })
    const app = new Application({ modules: [AuditModule()] })
    await app.setup()
    await app.setup()
    // Two setup() calls = one module-level entry, not two.
    expect(app.getContributors().filter((c) => c.key === 'audit')).toHaveLength(1)
  })
})
