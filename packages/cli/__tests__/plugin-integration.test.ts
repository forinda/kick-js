import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { runTypegen } from '../src/typegen/runner'
import { mergeCliPlugins, defineCliPlugin } from '../src/plugin'
import { kickDbTypegen } from '../src/typegen/builtin/db'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kick-plugin-int-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('CLI plugin integration', () => {
  it('plugin typegens flow through runTypegen alongside builtins', async () => {
    const fakeTypegen = {
      id: 'demo/echo',
      inputs: [] as string[],
      async generate() {
        return 'export type Demo = "ok"'
      },
    }
    // Builtins ship the kick/db typegen already; user plugin contributes one more.
    const userPlugin = defineCliPlugin({ name: 'demo', typegens: [fakeTypegen] })
    const merged = mergeCliPlugins([
      defineCliPlugin({ name: 'kick/db', typegens: [kickDbTypegen()] }),
      userPlugin,
    ])

    const results = await runTypegen({
      cwd: dir,
      config: {} as never,
      plugins: merged.typegens,
    })

    expect(results.map((r) => r.id)).toEqual(['kick/db', 'demo/echo'])
    expect(results[0].status).toBe('skipped') // no schema in tmp dir
    expect(results[1].status).toBe('written')
  })
})
