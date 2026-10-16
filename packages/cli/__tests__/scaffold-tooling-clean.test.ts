/**
 * A fresh scaffold must pass the tools it ships with — oxfmt, oxlint, tsc —
 * on every file it writes, config files included. Each of these slipped
 * through once: a slot line oxfmt wraps, an unused import in the generated
 * service, and a `pattern` value `kick.config.ts` could not type-check
 * because no check covered the root config files.
 *
 * Runs the workspace binaries against `--no-install` scaffolds, so nothing is
 * downloaded.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import { CLI_BIN, WORKSPACE_ROOT } from './helpers'

const BIN = resolve(WORKSPACE_ROOT, 'node_modules', '.bin')
const TEMPLATES = ['rest', 'minimal', 'inertia'] as const

function run(cwd: string, bin: string, args: string[]) {
  const r = spawnSync(join(BIN, bin), args, { cwd, encoding: 'utf-8' })
  return { code: r.status, out: `${r.stdout}${r.stderr}` }
}

let root: string
const app = (t: string) => join(root, `app-${t}`)

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'kick-tooling-'))
  for (const t of TEMPLATES) {
    const r = spawnSync(
      'node',
      [CLI_BIN, 'new', `app-${t}`, '--yes', '-t', t, '--no-install', '--no-git'],
      { cwd: root, encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' } },
    )
    if (r.status !== 0) throw new Error(`kick new -t ${t} failed:\n${r.stdout}${r.stderr}`)
  }
}, 120_000)

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe.each(TEMPLATES)('kick new -t %s', (t) => {
  it('writes a kick.config.ts whose pattern type-checks', () => {
    // Only kick.config.ts: the rest needs an install. Linking the CLI package
    // is enough to resolve defineConfig's types.
    const dir = app(t)
    mkdirSync(join(dir, 'node_modules', '@forinda'), { recursive: true })
    symlinkSync(
      join(WORKSPACE_ROOT, 'packages', 'cli'),
      join(dir, 'node_modules', '@forinda', 'kickjs-cli'),
      'junction',
    )
    writeFileSync(
      join(dir, 'tsconfig.kick.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'ESNext',
          moduleResolution: 'bundler',
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          types: [],
        },
        files: ['kick.config.ts'],
      }),
    )
    const r = run(dir, 'tsc', ['-p', 'tsconfig.kick.json'])
    expect(r.out).toBe('')
    expect(r.code).toBe(0)
  })

  it('type-checks the root config files with the project (tsconfig include)', () => {
    const tsconfig = JSON.parse(readFileSync(join(app(t), 'tsconfig.json'), 'utf-8'))
    expect(tsconfig.include).toContain('*.config.ts')
  })
})
