import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDbConfig } from '../../src/cli/config'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixtures = path.resolve(here, '../fixtures')

describe('resolveDbConfig', () => {
  it('reads schemaPath/migrationsDir/dialect from config', async () => {
    const cfg = await resolveDbConfig({
      configPath: path.join(fixtures, 'kick.config.demo.ts'),
    })
    expect(cfg).toEqual({
      schemaPath: './packages/db/__tests__/fixtures/schema.demo.ts',
      migrationsDir: './packages/db/__tests__/fixtures/migrations',
      dialect: 'postgres',
    })
  })

  it('returns sensible defaults when absent', async () => {
    const cfg = await resolveDbConfig({
      configPath: path.join(fixtures, 'kick.config.empty.ts'),
    })
    expect(cfg.dialect).toBe('postgres')
    expect(cfg.schemaPath).toBe('src/db/schema.ts')
    expect(cfg.migrationsDir).toBe('db/migrations')
  })
})
