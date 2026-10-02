/**
 * Tests for B-6 (architecture.md §21.2.1 + §21.3.3): plugin/adapter
 * registry typegen.
 *
 * Mixes unit tests against the scanner + generator helpers with one
 * E2E pass through the CLI binary so the full pipeline (scan → write
 * → tsc-readable output) is exercised.
 *
 * @module @forinda/kickjs-cli/__tests__/typegen-plugin-registry.test
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Container } from '@forinda/kickjs'
import { extractPluginsAndAdaptersFromSource } from '../src/typegen/scanner'
import { assertCliOk, cleanupFixture, createFixtureProject, runCli } from './helpers'

// Project rule: reset DI state before every test for isolation. Applies
// across all describes (runs before any describe-local beforeEach, e.g.
// the E2E fixture setup).
beforeEach(() => {
  Container.reset()
})

describe('scanner — extractPluginsAndAdaptersFromSource', () => {
  it('discovers a defineAdapter call by its `name:` field', () => {
    const source = `
      import { defineAdapter } from '@forinda/kickjs'
      export const TenantAdapter = defineAdapter<MultiTenantOptions>({
        name: 'TenantAdapter',
        defaults: { strategy: 'header' },
        build(config) { return {} },
      })
    `
    const out = extractPluginsAndAdaptersFromSource(source, '/fake/tenant.adapter.ts', '/fake')
    expect(out).toEqual([
      {
        kind: 'adapter',
        name: 'TenantAdapter',
        filePath: '/fake/tenant.adapter.ts',
        relativePath: 'tenant.adapter.ts',
      },
    ])
  })

  it('discovers a definePlugin call by its `name:` field', () => {
    const source = `
      import { definePlugin } from '@forinda/kickjs'
      export const FlagsPlugin = definePlugin<FlagsConfig>({
        name: 'FlagsPlugin',
        build() { return {} },
      })
    `
    const out = extractPluginsAndAdaptersFromSource(source, '/fake/flags.ts', '/fake')
    expect(out).toEqual([
      {
        kind: 'plugin',
        name: 'FlagsPlugin',
        filePath: '/fake/flags.ts',
        relativePath: 'flags.ts',
      },
    ])
  })

  it('takes the literal `name:` value, not the LHS symbol', () => {
    // The runtime contract is the string passed to defineAdapter — the
    // LHS const name is irrelevant for `dependsOn` resolution.
    const source = `
      import { defineAdapter } from '@forinda/kickjs'
      export const SurprisingExportName = defineAdapter({
        name: 'CanonicalAdapterName',
        build() { return {} },
      })
    `
    const out = extractPluginsAndAdaptersFromSource(source, '/fake/x.ts', '/fake')
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('CanonicalAdapterName')
  })

  it('discovers class-style adapters by their `name = "..."` field', () => {
    const source = `
      import type { AppAdapter } from '@forinda/kickjs'
      export class LegacyAdapter implements AppAdapter {
        name = 'LegacyAdapter'
        async beforeStart() {}
      }
    `
    const out = extractPluginsAndAdaptersFromSource(source, '/fake/legacy.ts', '/fake')
    expect(out).toEqual([
      {
        kind: 'adapter',
        name: 'LegacyAdapter',
        filePath: '/fake/legacy.ts',
        relativePath: 'legacy.ts',
      },
    ])
  })

  it('handles nested objects/parens in the call args', () => {
    // Regression: the balanced-paren walker mustn't terminate at the
    // first `}` inside a nested object literal.
    const source = `
      import { defineAdapter } from '@forinda/kickjs'
      export const X = defineAdapter({
        name: 'X',
        defaults: { foo: { bar: { baz: 1 } } },
        build(c) { return { middleware: () => [() => {}] } },
      })
    `
    const out = extractPluginsAndAdaptersFromSource(source, '/fake/x.ts', '/fake')
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('X')
  })

  it('skips define calls that have no string-literal `name`', () => {
    // Computed names (`name: someConstant`) can't be statically extracted,
    // and there's nothing useful to put in the registry — the typegen
    // layer is a best-effort enhancement.
    const source = `
      import { defineAdapter } from '@forinda/kickjs'
      const NAME = 'Dynamic'
      export const X = defineAdapter({ name: NAME, build() { return {} } })
    `
    const out = extractPluginsAndAdaptersFromSource(source, '/fake/x.ts', '/fake')
    expect(out).toEqual([])
  })

  it('returns an empty array when no plugins/adapters are present', () => {
    const source = `export const x = 1`
    const out = extractPluginsAndAdaptersFromSource(source, '/fake/empty.ts', '/fake')
    expect(out).toEqual([])
  })

  it('finds multiple plugins/adapters in one file', () => {
    const source = `
      import { defineAdapter, definePlugin } from '@forinda/kickjs'
      export const A = defineAdapter({ name: 'A', build() { return {} } })
      export const B = definePlugin({ name: 'B', build() { return {} } })
    `
    const out = extractPluginsAndAdaptersFromSource(source, '/fake/multi.ts', '/fake')
    expect(out.map((x) => `${x.kind}:${x.name}`)).toEqual(['adapter:A', 'plugin:B'])
  })
})

describe('kick typegen — plugins.d.ts E2E', () => {
  let fixture: string

  beforeEach(() => {
    fixture = createFixtureProject('typegen-plugins')
  })

  afterEach(() => {
    cleanupFixture(fixture)
  })

  function writeFile(path: string, content: string) {
    const full = join(fixture, path)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }

  it('produces plugins.d.ts on every run, and no augmentation catalogue', () => {
    const result = runCli(fixture, ['typegen'])
    assertCliOk(result, 'kick typegen')
    expect(existsSync(join(fixture, '.kickjs/types/kick__plugins.d.ts'))).toBe(true)
    expect(existsSync(join(fixture, '.kickjs/types/kick__augmentations.d.ts'))).toBe(false)
  })

  it('auto-populates ContextKeys from context-decorator key literals', () => {
    writeFile(
      'src/contributors/tenant.contributor.ts',
      `import { defineHttpContextDecorator } from '@forinda/kickjs'
export const Tenant = defineHttpContextDecorator({
  key: 'tenant',
  resolve: (ctx) => ({ id: ctx.req.headers['x-tenant-id'] }),
})
`,
    )
    writeFile(
      'src/contributors/session.contributor.ts',
      `import { defineContextDecorator } from '@forinda/kickjs'
export const Session = defineContextDecorator.withParams<{ source: string }>()({
  key: 'session',
  paramDefaults: { source: '' },
  resolve: (_ctx, _deps, params) => ({ source: params.source }),
})
`,
    )

    runCli(fixture, ['typegen'])

    const ctx = readFileSync(join(fixture, '.kickjs/types/kick__context.d.ts'), 'utf-8')
    expect(ctx).toContain("declare module '@forinda/kickjs'")
    expect(ctx).toContain('interface ContextKeys')
    expect(ctx).toContain('tenant: true')
    expect(ctx).toContain('session: true')
  })

  it('skips kick__context.d.ts when no context decorators exist', () => {
    runCli(fixture, ['typegen'])
    expect(existsSync(join(fixture, '.kickjs/types/kick__context.d.ts'))).toBe(false)
  })

  it('augments KickJsPluginRegistry with discovered names', () => {
    writeFile(
      'src/adapters/tenant.adapter.ts',
      `import { defineAdapter } from '@forinda/kickjs'
export const TenantAdapter = defineAdapter({
  name: 'TenantAdapter',
  build() { return {} },
})
`,
    )
    writeFile(
      'src/adapters/auth.adapter.ts',
      `import { defineAdapter } from '@forinda/kickjs'
export const AuthAdapter = defineAdapter({
  name: 'AuthAdapter',
  build() { return {} },
})
`,
    )
    writeFile(
      'src/plugins/flags.ts',
      `import { definePlugin } from '@forinda/kickjs'
export const FlagsPlugin = definePlugin({
  name: 'FlagsPlugin',
  build() { return {} },
})
`,
    )

    runCli(fixture, ['typegen'])

    const plugins = readFileSync(join(fixture, '.kickjs/types/kick__plugins.d.ts'), 'utf-8')
    expect(plugins).toContain("declare module '@forinda/kickjs'")
    expect(plugins).toContain('interface KickJsPluginRegistry')
    expect(plugins).toContain("'TenantAdapter': 'adapter'")
    expect(plugins).toContain("'AuthAdapter': 'adapter'")
    expect(plugins).toContain("'FlagsPlugin': 'plugin'")
  })

  it('emits an empty registry when no plugins/adapters exist', () => {
    runCli(fixture, ['typegen'])
    const plugins = readFileSync(join(fixture, '.kickjs/types/kick__plugins.d.ts'), 'utf-8')
    expect(plugins).toContain('interface KickJsPluginRegistry')
    expect(plugins).toContain('no plugins/adapters discovered yet')
  })

  it('reports the plugin/adapter count in the typegen log', () => {
    writeFile(
      'src/x.ts',
      `import { defineAdapter } from '@forinda/kickjs'
export const X = defineAdapter({ name: 'X', build() { return {} } })
export const Y = defineAdapter({ name: 'Y', build() { return {} } })
`,
    )
    const result = runCli(fixture, ['typegen'])
    assertCliOk(result, 'kick typegen')
    expect(result.stdout).toMatch(/2 plugins\/adapters/)
  })
})
