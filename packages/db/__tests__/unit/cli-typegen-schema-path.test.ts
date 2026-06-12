import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { kickDbTypegen } from '../../src/cli-typegen'

let project: string

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'kick-db-tg-'))
})

afterEach(() => {
  rmSync(project, { recursive: true, force: true })
})

function writeSchema(relPath: string): void {
  const abs = join(project, relPath)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, 'export const users = {}\n')
}

describe('kickDbTypegen schema resolution', () => {
  it('honours db.schemaPath from kick.config (parity with `kick db generate`)', async () => {
    writeSchema('src/database/my-schema.ts')
    const out = await kickDbTypegen().generate({
      cwd: project,
      config: { db: { schemaPath: 'src/database/my-schema.ts' } },
    })
    expect(out).not.toBeNull()
    expect(out).toContain("from '../../src/database/my-schema'")
  })

  it('falls back to the default candidates when no config path is set', async () => {
    writeSchema('src/db/schema.ts')
    const out = await kickDbTypegen().generate({ cwd: project, config: {} })
    expect(out).not.toBeNull()
    expect(out).toContain("from '../../src/db/schema'")
  })

  it('configured path missing → falls back to candidates rather than emitting a broken import', async () => {
    writeSchema('src/db/schema.ts')
    const out = await kickDbTypegen().generate({
      cwd: project,
      config: { db: { schemaPath: 'src/nowhere/schema.ts' } },
    })
    expect(out).not.toBeNull()
    expect(out).toContain("from '../../src/db/schema'")
  })

  it('returns null when nothing resolves', async () => {
    const out = await kickDbTypegen().generate({ cwd: project, config: {} })
    expect(out).toBeNull()
  })
})
