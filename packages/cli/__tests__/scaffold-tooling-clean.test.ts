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

import { CLI_BIN, WORKSPACE_ROOT, runCli } from './helpers'

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
  it('passes oxfmt --check on src and the config files', () => {
    const r = run(app(t), 'oxfmt', ['--check', 'src', 'kick.config.ts', 'vite.config.ts'])
    expect(r.out).not.toContain('Format issues')
    expect(r.code).toBe(0)
  })

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

describe('kick g module (rest)', () => {
  it('generates files oxlint passes with no warnings', () => {
    const dir = app('rest')
    const r = runCli(dir, ['g', 'module', 'task'])
    expect(r.exitCode).toBe(0)
    const lint = run(dir, 'oxlint', ['--deny-warnings', 'src/modules/task'])
    expect(lint.out).not.toContain('warning')
    expect(lint.code).toBe(0)
  })
})

describe('kick g in a project without oxfmt installed', () => {
  it("formats with the CLI's own oxfmt, as vp migrate leaves it", () => {
    const dir = mkdtempSync(join(root, 'no-oxfmt-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'p', type: 'module' }))
    writeFileSync(
      join(dir, '.oxfmtrc.json'),
      readFileSync(resolve(CLI_BIN, '../../templates/base/files/_dot_oxfmtrc.json')),
    )
    // The second module wraps the modules-index chain past 100 columns
    // unless a formatter runs.
    for (const name of ['task', 'note']) expect(runCli(dir, ['g', 'module', name]).exitCode).toBe(0)
    const r = run(dir, 'oxfmt', ['--check', 'src'])
    expect(r.out).not.toContain('Format issues')
    expect(r.code).toBe(0)
  })
})

describe('generated test imports', () => {
  const imports = (dir: string, file: string) =>
    readFileSync(join(dir, file), 'utf-8').split('\n')[0]

  function project(deps: Record<string, string>) {
    const dir = mkdtempSync(join(root, 'proj-'))
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'p', type: 'module', devDependencies: deps }),
    )
    for (const args of [
      ['g', 'module', 'task'],
      ['g', 'test', 'thing'],
    ]) {
      const r = runCli(dir, args)
      if (r.exitCode !== 0) throw new Error(`kick ${args.join(' ')}:\n${r.stdout}${r.stderr}`)
    }
    return dir
  }

  const files = [
    'src/modules/task/__tests__/task.controller.test.ts',
    'src/modules/task/__tests__/task.repository.test.ts',
    'src/__tests__/thing.test.ts',
  ]

  it("import from 'vitest' in a vitest project", () => {
    const dir = project({ vitest: '^4.0.0' })
    for (const f of files) expect(imports(dir, f)).toMatch(/from 'vitest'$/)
  })

  it("import from 'vite-plus/test' once vp migrate has replaced vitest", () => {
    const dir = project({ 'vite-plus': '^1.3.0' })
    for (const f of files) expect(imports(dir, f)).toMatch(/from 'vite-plus\/test'$/)
  })

  it("keep 'vitest' when both are installed", () => {
    const dir = project({ 'vite-plus': '^1.3.0', vitest: '^4.0.0' })
    for (const f of files) expect(imports(dir, f)).toMatch(/from 'vitest'$/)
  })
})
