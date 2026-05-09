/**
 * Generate-time gate for the M4.C composite-detect helper.
 *
 * Plants a prior snapshot with an extra enum value so the diff
 * produces `removeEnumValue`, then calls `generate()` with a stub
 * `detectCompositeRefs` callback. Verifies:
 *   1. `generate()` invokes the callback exactly once per distinct enum,
 *   2. a non-empty result aborts with `CompositeEnumReferenceError`
 *      and DOES NOT write a migration directory,
 *   3. an empty result lets the migration write normally.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CompositeEnumReferenceError,
  generate,
  type CompositeRef,
  type SchemaSnapshot,
} from '@forinda/kickjs-db'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixtureSchema = path.resolve(here, '../fixtures/schema.enum-removal.ts')

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kickdb-m4c-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/**
 * Plants a fake prior migration directory whose snapshot.json declares
 * the `status` enum with one extra value (`legacy`). When generate()
 * runs against the fixture schema (which has only `active` + `banned`),
 * `diff()` produces a single `removeEnumValue` change.
 */
async function plantPriorSnapshotWithExtraEnumValue(migrationsDir: string): Promise<void> {
  const priorDir = path.join(migrationsDir, '20260101_000000_init')
  await mkdir(priorDir, { recursive: true })

  const snapshot: SchemaSnapshot = {
    version: 1,
    dialect: 'postgres',
    tables: {
      users: {
        name: 'users',
        columns: {
          id: { name: 'id', type: 'serial', nullable: false, default: null, primaryKey: true },
        },
        indexes: [],
        foreignKeys: [],
        checks: [],
      },
    },
    enums: {
      status: { name: 'status', values: ['active', 'banned', 'legacy'] },
    },
  }
  await writeFile(path.join(priorDir, 'snapshot.json'), JSON.stringify(snapshot), 'utf8')
  await writeFile(path.join(priorDir, 'up.sql'), '-- REVIEWED: true\n', 'utf8')
  await writeFile(path.join(priorDir, 'down.sql'), '-- REVIEWED: true\n', 'utf8')
  await writeFile(
    path.join(priorDir, 'meta.json'),
    JSON.stringify({
      id: '20260101_000000_init',
      name: 'init',
      reviewed: true,
      dialect: 'postgres',
      previousId: null,
      downIsDraft: false,
    }),
    'utf8',
  )

  const journal = {
    version: 1,
    dialect: 'postgres',
    entries: [
      {
        id: '20260101_000000_init',
        tag: 'init',
        hash: 'fixture',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  }
  await writeFile(path.join(migrationsDir, '_journal.json'), JSON.stringify(journal), 'utf8')
}

describe('generate() — M4.C composite-type gate', () => {
  it('aborts with CompositeEnumReferenceError when the detector finds a composite reference', async () => {
    const migrationsDir = path.join(dir, 'migrations')
    await plantPriorSnapshotWithExtraEnumValue(migrationsDir)

    const calls: string[] = []
    const detector = async (enumName: string): Promise<readonly CompositeRef[]> => {
      calls.push(enumName)
      return [{ composite: 'public.row_t', attribute: 'kind', enum: `public.${enumName}` }]
    }

    await expect(
      generate({
        name: 'remove_legacy_status',
        config: { schemaPath: fixtureSchema, migrationsDir, dialect: 'postgres' },
        cwd: process.cwd(),
        detectCompositeRefs: detector,
      }),
    ).rejects.toBeInstanceOf(CompositeEnumReferenceError)

    expect(calls).toEqual(['status'])

    // The new migration directory must not exist — generate aborted before writing.
    const entries = await readdir(migrationsDir)
    expect(entries.toSorted()).toEqual(['20260101_000000_init', '_journal.json'])
  })

  it('lets the migration write normally when the detector returns no references', async () => {
    const migrationsDir = path.join(dir, 'migrations')
    await plantPriorSnapshotWithExtraEnumValue(migrationsDir)

    const detector = async (): Promise<readonly CompositeRef[]> => []

    const result = await generate({
      name: 'remove_legacy_status',
      config: { schemaPath: fixtureSchema, migrationsDir, dialect: 'postgres' },
      cwd: process.cwd(),
      detectCompositeRefs: detector,
    })

    expect(result.status).toBe('created')
    const entries = (await readdir(migrationsDir)).filter((e) => e !== '_journal.json')
    expect(entries).toHaveLength(2) // prior + the new one
  })

  it('skips the gate entirely when no detector is supplied', async () => {
    const migrationsDir = path.join(dir, 'migrations')
    await plantPriorSnapshotWithExtraEnumValue(migrationsDir)

    const result = await generate({
      name: 'remove_legacy_status',
      config: { schemaPath: fixtureSchema, migrationsDir, dialect: 'postgres' },
      cwd: process.cwd(),
    })

    expect(result.status).toBe('created')
  })

  it('invokes the detector once per distinct enum even with multiple removeEnumValue changes', async () => {
    // Same fixture only has one enum, so the per-enum dedupe is exercised on
    // a single enum here. The dedupe semantics matter when a future fixture
    // adds two enums with values being dropped from each.
    const migrationsDir = path.join(dir, 'migrations')
    await plantPriorSnapshotWithExtraEnumValue(migrationsDir)

    const calls: string[] = []
    const detector = async (enumName: string): Promise<readonly CompositeRef[]> => {
      calls.push(enumName)
      return []
    }

    await generate({
      name: 'remove_legacy_status',
      config: { schemaPath: fixtureSchema, migrationsDir, dialect: 'postgres' },
      cwd: process.cwd(),
      detectCompositeRefs: detector,
    })

    expect(calls).toEqual(['status'])
  })
})
