/**
 * Tests for B-6 (architecture.md §21.2.1 + §21.3.3): plugin/adapter
 * registry typegen + `defineAugmentation` discovery.
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
import {
  extractAugmentationsFromSource,
  extractPluginsAndAdaptersFromSource,
} from '../src/typegen/scanner'
import { assertCliOk, cleanupFixture, createFixtureProject, runCli } from './helpers'

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

describe('scanner — extractAugmentationsFromSource', () => {
  it('discovers a defineAugmentation call with metadata', () => {
    const source = `
      import { defineAugmentation } from '@forinda/kickjs'
      defineAugmentation('FeatureFlags', {
        description: 'Flags consumed by FlagsPlugin',
        example: '{ beta: boolean }',
      })
    `
    const out = extractAugmentationsFromSource(source, '/fake/flags.ts', '/fake')
    expect(out).toEqual([
      {
        name: 'FeatureFlags',
        description: 'Flags consumed by FlagsPlugin',
        example: '{ beta: boolean }',
        filePath: '/fake/flags.ts',
        relativePath: 'flags.ts',
      },
    ])
  })

  it('handles defineAugmentation with no metadata arg', () => {
    const source = `
      import { defineAugmentation } from '@forinda/kickjs'
      defineAugmentation('SimpleAugmentation')
    `
    const out = extractAugmentationsFromSource(source, '/fake/x.ts', '/fake')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      name: 'SimpleAugmentation',
      description: null,
      example: null,
    })
  })

  it('finds multiple augmentations across one file', () => {
    const source = `
      import { defineAugmentation } from '@forinda/kickjs'
      defineAugmentation('A', { description: 'first' })
      defineAugmentation('B', { example: '{ x: 1 }' })
    `
    const out = extractAugmentationsFromSource(source, '/fake/x.ts', '/fake')
    expect(out.map((x) => x.name)).toEqual(['A', 'B'])
  })

  it('preserves backtick-string values containing single quotes (real-world example shape)', () => {
    // Regression: prior regex `[^'"\`]+` truncated at the first foreign
    // quote, so a backtick-delimited example like
    // `{ plan: 'free' | 'pro' }` would clip at the first `'`. Both the
    // description and example should round-trip the full source text.
    const source = [
      "import { defineAugmentation } from '@forinda/kickjs'",
      "defineAugmentation('ContextMeta', {",
      '  description: `Tenant resolved by TenantAdapter.`,',
      '  example: `{',
      "    tenant: { id: string; plan: 'free' | 'pro' | 'enterprise' }",
      '  }`,',
      '})',
    ].join('\n')
    const out = extractAugmentationsFromSource(source, '/fake/aug.ts', '/fake')
    expect(out).toHaveLength(1)
    expect(out[0].description).toBe('Tenant resolved by TenantAdapter.')
    expect(out[0].example).toContain("plan: 'free' | 'pro' | 'enterprise'")
  })

  it('unescapes backslash escapes inside backtick string values', () => {
    // Regression: previously `\\\`` survived into the catalogue as a
    // literal backslash + backtick, breaking the JSDoc render. The
    // parser should strip the backslash so the output is clean markdown.
    // Using String.raw so the test fixture is a faithful copy of what
    // a user would actually type into a `.ts` file.
    const source = String.raw`
      import { defineAugmentation } from '@forinda/kickjs'
      defineAugmentation('Foo', {
        description: ${'`'}Use \`ctx.get(\'foo\')\` to read it.${'`'},
      })
    `
    const out = extractAugmentationsFromSource(source, '/fake/aug.ts', '/fake')
    expect(out).toHaveLength(1)
    expect(out[0].description).toBe("Use `ctx.get('foo')` to read it.")
  })

  it('preserves multi-line description and example through line-prefixed JSDoc', () => {
    // Multi-line backtick literals must survive verbatim — the
    // generator splits on \n and prefixes each line with ` * `.
    const source = [
      "import { defineAugmentation } from '@forinda/kickjs'",
      "defineAugmentation('Multi', {",
      '  description: `line one',
      'line two',
      'line three`,',
      '})',
    ].join('\n')
    const out = extractAugmentationsFromSource(source, '/fake/aug.ts', '/fake')
    expect(out).toHaveLength(1)
    expect(out[0].description).toBe('line one\nline two\nline three')
  })
})

describe('kick typegen — plugins.d.ts + augmentations.d.ts E2E', () => {
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

  it('produces plugins.d.ts and augmentations.d.ts on every run', () => {
    const result = runCli(fixture, ['typegen'])
    assertCliOk(result, 'kick typegen')
    expect(existsSync(join(fixture, '.kickjs/types/plugins.d.ts'))).toBe(true)
    expect(existsSync(join(fixture, '.kickjs/types/augmentations.d.ts'))).toBe(true)
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

    const plugins = readFileSync(join(fixture, '.kickjs/types/plugins.d.ts'), 'utf-8')
    expect(plugins).toContain("declare module '@forinda/kickjs'")
    expect(plugins).toContain('interface KickJsPluginRegistry')
    expect(plugins).toContain("'TenantAdapter': 'adapter'")
    expect(plugins).toContain("'AuthAdapter': 'adapter'")
    expect(plugins).toContain("'FlagsPlugin': 'plugin'")
  })

  it('catalogues defineAugmentation calls into augmentations.d.ts', () => {
    writeFile(
      'src/plugins/flags.ts',
      `import { definePlugin, defineAugmentation } from '@forinda/kickjs'

export interface FeatureFlags {}

defineAugmentation('FeatureFlags', {
  description: 'Flags consumed by FlagsPlugin',
  example: '{ beta: boolean; rolloutPercentage: number }',
})

export const FlagsPlugin = definePlugin({
  name: 'FlagsPlugin',
  build() { return {} },
})
`,
    )

    runCli(fixture, ['typegen'])

    const aug = readFileSync(join(fixture, '.kickjs/types/augmentations.d.ts'), 'utf-8')
    expect(aug).toContain('FeatureFlagsAugmentation')
    expect(aug).toContain('Flags consumed by FlagsPlugin')
    expect(aug).toContain('{ beta: boolean; rolloutPercentage: number }')
    expect(aug).toContain('@see src/plugins/flags.ts')
  })

  it('emits an empty registry when no plugins/adapters exist', () => {
    runCli(fixture, ['typegen'])
    const plugins = readFileSync(join(fixture, '.kickjs/types/plugins.d.ts'), 'utf-8')
    expect(plugins).toContain('interface KickJsPluginRegistry')
    expect(plugins).toContain('no plugins/adapters discovered yet')
  })

  it('reports plugin/adapter and augmentation counts in the typegen log', () => {
    writeFile(
      'src/x.ts',
      `import { defineAdapter, defineAugmentation } from '@forinda/kickjs'
defineAugmentation('Thing')
export const X = defineAdapter({ name: 'X', build() { return {} } })
export const Y = defineAdapter({ name: 'Y', build() { return {} } })
`,
    )
    const result = runCli(fixture, ['typegen'])
    assertCliOk(result, 'kick typegen')
    expect(result.stdout).toMatch(/2 plugins\/adapters/)
    expect(result.stdout).toMatch(/1 augmentations/)
  })
})
