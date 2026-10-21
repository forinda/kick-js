/**
 * `kick` from outside a project (a global install) hands off to the project's
 * own CLI, so only the project's @forinda/kickjs — and DI container — loads.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const BIN = resolve(import.meta.dirname, '../bin.js')

function project(declares = true): string {
  const root = mkdtempSync(join(tmpdir(), 'kick-handoff-'))
  const deps = declares ? { devDependencies: { '@forinda/kickjs-cli': '^8.0.0' } } : {}
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'app', ...deps }))
  const cli = join(root, 'node_modules/@forinda/kickjs-cli')
  mkdirSync(cli, { recursive: true })
  writeFileSync(
    join(cli, 'package.json'),
    JSON.stringify({ name: '@forinda/kickjs-cli', bin: { kick: 'bin.js' } }),
  )
  writeFileSync(
    join(cli, 'bin.js'),
    "console.log('project cli', process.argv.slice(2).join(' '))\n",
  )
  mkdirSync(join(root, 'src/modules'), { recursive: true })
  return root
}

describe('bin.js', () => {
  it("runs the project's CLI from anywhere inside the project", () => {
    const root = project()
    const out = execFileSync('node', [BIN, 'routes', '--json'], {
      cwd: join(root, 'src/modules'),
      encoding: 'utf8',
    })
    expect(out.trim()).toBe('project cli routes --json')
  })

  it("ignores a node_modules whose folder doesn't list the CLI", () => {
    const root = project(false)
    const out = execFileSync('node', [BIN, '--version'], { cwd: root, encoding: 'utf8' })
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('stays put with KICK_NO_HANDOFF=1', () => {
    const root = project()
    const out = execFileSync('node', [BIN, '--version'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, KICK_NO_HANDOFF: '1' },
    })
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('runs itself outside a project', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kick-handoff-none-'))
    const out = execFileSync('node', [BIN, '--version'], { cwd: dir, encoding: 'utf8' })
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+/)
  })
})
