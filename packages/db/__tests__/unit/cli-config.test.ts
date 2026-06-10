import { describe, it, expect } from 'vitest'
import {
  defineKickDbConfig,
  mergeKickDbConfig,
  resolveKickDbConfig,
  dbCliPlugin,
} from '../../src/cli'

describe('defineKickDbConfig', () => {
  it('returns the config verbatim (identity helper)', () => {
    const cfg = defineKickDbConfig({ dialect: 'sqlite', schemaPath: 'x.ts' })
    expect(cfg).toEqual({ dialect: 'sqlite', schemaPath: 'x.ts' })
  })
})

describe('mergeKickDbConfig', () => {
  it('shallow-merges with later sources winning', () => {
    expect(
      mergeKickDbConfig({ dialect: 'postgres', schemaPath: 'base.ts' }, undefined, {
        schemaPath: 'override.ts',
        migrationsDir: 'm',
      }),
    ).toEqual({ dialect: 'postgres', schemaPath: 'override.ts', migrationsDir: 'm' })
  })

  it('ignores undefined sources', () => {
    expect(mergeKickDbConfig(undefined, { dialect: 'mysql' })).toEqual({ dialect: 'mysql' })
  })
})

describe('resolveKickDbConfig', () => {
  it('applies defaults for an empty / missing block', () => {
    expect(resolveKickDbConfig(undefined)).toMatchObject({
      schemaPath: 'src/db/schema.ts',
      migrationsDir: 'db/migrations',
      dialect: 'postgres',
    })
  })

  it('honours explicit fields over defaults', () => {
    const r = resolveKickDbConfig({ dialect: 'sqlite', migrationsDir: 'custom/mig' })
    expect(r.dialect).toBe('sqlite')
    expect(r.migrationsDir).toBe('custom/mig')
    expect(r.schemaPath).toBe('src/db/schema.ts')
  })
})

describe('dbCliPlugin', () => {
  it('is a kick/db CLI plugin with a register hook', () => {
    expect(dbCliPlugin.name).toBe('kick/db')
    expect(typeof dbCliPlugin.register).toBe('function')
  })
})
