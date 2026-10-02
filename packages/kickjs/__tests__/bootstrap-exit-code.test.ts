/**
 * KickJS's own uncaughtException / unhandledRejection listeners replace
 * Node's, which exit with 1 — so a boot that throws used to end the process
 * with 0, and a deploy read the crash as success. Run in a child process:
 * the exit code is what's under test.
 */
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const entry = resolve(__dirname, '../src/index.ts')
const tsx = resolve(__dirname, '../../../node_modules/.bin/tsx')

describe('bootstrap exit code', () => {
  it('exits non-zero when an adapter refuses to start', () => {
    // Inside the package, so the script resolves its dependencies.
    const dir = mkdtempSync(resolve(__dirname, '../node_modules/.kick-exit-'))
    const script = join(dir, 'main.mts')
    writeFileSync(
      script,
      `import 'reflect-metadata'
import { bootstrap } from ${JSON.stringify(entry)}
await bootstrap({
  modules: [],
  port: 0,
  adapters: [{ name: 'Migrations', beforeStart() { throw new Error('2 pending migrations') } }],
})
`,
    )
    const run = spawnSync(tsx, [script], { encoding: 'utf8', timeout: 60_000 })
    rmSync(dir, { recursive: true, force: true })
    expect(run.stdout + run.stderr).toContain('2 pending migrations')
    expect(run.status).toBe(1)
  }, 60_000)
})
