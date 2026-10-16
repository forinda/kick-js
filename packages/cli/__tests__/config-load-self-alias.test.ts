/**
 * `kick.config.ts` imports `defineConfig` from `@forinda/kickjs-cli`. Before
 * the project's deps are installed — `kick new` runs typegen and writes agent
 * docs before (or without) install — that import can't resolve, and every
 * config load warned "Failed to load kick.config.ts". The loader now maps the
 * package to the running CLI when the project doesn't have it.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadKickConfig } from '../src/config'

describe('loadKickConfig without @forinda/kickjs-cli installed', () => {
  let root: string
  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(root, { recursive: true, force: true })
  })

  it('loads a config that imports defineConfig, without warning', async () => {
    root = mkdtempSync(join(tmpdir(), 'kick-config-'))
    writeFileSync(join(root, 'package.json'), '{ "name": "app" }')
    writeFileSync(
      join(root, 'kick.config.ts'),
      "import { defineConfig } from '@forinda/kickjs-cli'\n\nexport default defineConfig({ pattern: 'rest' })\n",
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const config = await loadKickConfig(root)

    expect(config).toMatchObject({ pattern: 'rest' })
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('loadKickConfig resolves the project tsconfig paths', () => {
  let root: string
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it("a lazy import in the config can reach a file that imports '@/config'", async () => {
    root = mkdtempSync(join(tmpdir(), 'kick-config-paths-'))
    const { mkdirSync } = await import('node:fs')
    mkdirSync(join(root, 'src/config'), { recursive: true })
    mkdirSync(join(root, 'src/db'), { recursive: true })
    writeFileSync(join(root, 'package.json'), '{ "name": "app", "type": "module" }')
    writeFileSync(
      join(root, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }),
    )
    writeFileSync(join(root, 'src/config/index.ts'), "export const url = 'postgres://x'\n")
    writeFileSync(
      join(root, 'src/db/client.ts'),
      "import { url } from '@/config'\nexport const client = { url }\n",
    )
    // What `kick db migrate` does: call a factory that imports the app's client.
    writeFileSync(
      join(root, 'kick.config.ts'),
      "export default { db: { adapter: async () => (await import('./src/db/client')).client } }\n",
    )

    const config = (await loadKickConfig(root)) as unknown as {
      db: { adapter: () => Promise<{ url: string }> }
    }
    await expect(config.db.adapter()).resolves.toEqual({ url: 'postgres://x' })
  })
})
