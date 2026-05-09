/**
 * Locks the type contract for the `db` block on `KickConfig`. Adopters
 * who hit the M4.C composite-detect path set this in `kick.config.ts`;
 * before this addition the field type-checked as an unknown excess
 * property and the CLI's `resolveDbConfig` read it via untyped
 * fallthrough — TS rejected the literal even though runtime worked.
 */

import { describe, it, expect, expectTypeOf } from 'vitest'

import { defineConfig, type KickDbConfigBlock } from '../src/config'

describe('KickConfig.db block', () => {
  it('defineConfig accepts a fully-populated db block', () => {
    const config = defineConfig({
      db: {
        schemaPath: 'src/db/schema.ts',
        migrationsDir: 'db/migrations',
        dialect: 'postgres',
        connectionString: 'postgres://x:y@localhost:5432/test',
      },
    })

    expect(config.db?.dialect).toBe('postgres')
    expect(config.db?.connectionString).toContain('localhost')
  })

  it('defineConfig accepts an adapter factory in lieu of connectionString', () => {
    const config = defineConfig({
      db: {
        schemaPath: 'src/db/schema.ts',
        migrationsDir: 'db/migrations',
        adapter: () => ({ dialect: 'postgres' as const }),
      },
    })

    expect(typeof config.db?.adapter).toBe('function')
  })

  it('every db field is optional (resolveDbConfig fills defaults)', () => {
    const cfg = defineConfig({ db: {} })
    expect(cfg.db).toEqual({})
  })

  it('KickDbConfigBlock typing matches the exported shape', () => {
    expectTypeOf<KickDbConfigBlock>().toEqualTypeOf<{
      schemaPath?: string
      migrationsDir?: string
      dialect?: 'postgres' | 'sqlite' | 'mysql'
      connectionString?: string
      adapter?: () => unknown | Promise<unknown>
    }>()
  })
})
