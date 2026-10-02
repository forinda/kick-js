/**
 * The journal hash is "what someone reviewed": hand-written or edited SQL in
 * a pending migration applies once reviewed, and an edit after review is
 * refused until it's reviewed again.
 */
import { describe, expect, it } from 'vitest'
import { appendFile, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MemoryMigrationAdapter,
  generate,
  migrateLatest,
  reviewMigration,
} from '@forinda/kickjs-db'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixtureSchema = path.resolve(here, '../fixtures/schema.demo.ts')

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), 'kickdb-review-'))
  const config = {
    schemaPath: fixtureSchema,
    migrationsDir: path.join(dir, 'm'),
    dialect: 'postgres' as const,
  }
  const gen = await generate({ name: 'seed', config, cwd: process.cwd(), empty: true })
  return {
    config,
    id: path.basename(gen.migrationDir!),
    up: path.join(gen.migrationDir!, 'up.sql'),
  }
}

describe('review records the hash of what was reviewed', () => {
  it('applies a hand-written --empty migration once reviewed', async () => {
    const { config, id, up } = await setup()
    await appendFile(up, "INSERT INTO roles (name) VALUES ('admin');\n")
    await reviewMigration(config.migrationsDir, id)

    const adapter = new MemoryMigrationAdapter()
    await expect(
      migrateLatest({ adapter, migrationsDir: config.migrationsDir, requireReviewed: true }),
    ).resolves.toMatchObject({ applied: [id] })
  })

  it('refuses an edit made after review, until reviewed again', async () => {
    const { config, id, up } = await setup()
    await reviewMigration(config.migrationsDir, id)
    await appendFile(up, '-- changed my mind\n')

    const run = () =>
      migrateLatest({
        adapter: new MemoryMigrationAdapter(),
        migrationsDir: config.migrationsDir,
        requireReviewed: true,
      })
    await expect(run()).rejects.toThrow(/hash/i)

    expect((await reviewMigration(config.migrationsDir, id)).alreadyReviewed).toBe(true)
    await expect(run()).resolves.toMatchObject({ applied: [id] })
  })

  it('applies an edited, unreviewed migration in development', async () => {
    const { config, id, up } = await setup()
    await writeFile(up, "INSERT INTO roles (name) VALUES ('dev');\n")
    await expect(
      migrateLatest({
        adapter: new MemoryMigrationAdapter(),
        migrationsDir: config.migrationsDir,
        requireReviewed: false,
      }),
    ).resolves.toMatchObject({ applied: [id] })
  })
})
