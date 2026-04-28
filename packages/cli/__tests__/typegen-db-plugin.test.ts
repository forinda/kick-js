import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { runTypegen } from '../src/typegen/runner'
import { kickDbTypegen } from '../src/typegen/builtin/db'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kick-db-plugin-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('kickDbTypegen', () => {
  it('skips emission when no schema is present', async () => {
    const r = await runTypegen({
      cwd: dir,
      config: {} as never,
      plugins: [kickDbTypegen()],
    })
    expect(r[0].status).toBe('skipped')
  })

  it('emits the KickDbRegister augmentation for src/db/schema.ts', async () => {
    await mkdir(path.join(dir, 'src/db'), { recursive: true })
    await writeFile(path.join(dir, 'src/db/schema.ts'), 'export const users = {}')

    const r = await runTypegen({
      cwd: dir,
      config: {} as never,
      plugins: [kickDbTypegen()],
    })
    expect(r[0].status).toBe('written')
    expect(r[0].outFile).toMatch(/kick__db\.d\.ts$/)

    const out = await readFile(r[0].outFile!, 'utf8')
    expect(out).toContain(`import type * as appSchema from '../../src/db/schema'`)
    expect(out).toContain(`interface KickDbSchema extends SchemaToTypes<typeof appSchema>`)
    expect(out).toContain(`declare module '@forinda/kickjs-db'`)
    expect(out).toContain(`interface KickDbRegister`)
    expect(out).toContain(`db: KickDbClient<KickDbSchema>`)
  })

  it('resolves a barrel folder layout (src/db/schema/index.ts)', async () => {
    await mkdir(path.join(dir, 'src/db/schema'), { recursive: true })
    await writeFile(
      path.join(dir, 'src/db/schema/index.ts'),
      `export * from './users'\n`,
    )
    await writeFile(path.join(dir, 'src/db/schema/users.ts'), 'export const users = {}')

    const r = await runTypegen({
      cwd: dir,
      config: {} as never,
      plugins: [kickDbTypegen()],
    })
    expect(r[0].status).toBe('written')
    const out = await readFile(r[0].outFile!, 'utf8')
    // Trailing /index is stripped — the import specifier stays stable
    // across single-file and barrel-folder layouts.
    expect(out).toContain(`import type * as appSchema from '../../src/db/schema'`)
    expect(out).not.toContain(`/index'`)
  })
})
