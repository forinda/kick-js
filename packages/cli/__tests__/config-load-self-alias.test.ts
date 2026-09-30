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
