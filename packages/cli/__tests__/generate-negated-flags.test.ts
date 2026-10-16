/**
 * `kick g module <name> --no-pluralize` — the `--no-*` flags are declared on
 * both `kick g` and its subcommands, and Commander binds them to the parent.
 * They must still reach the generator whichever side ends up holding them.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Command } from 'commander'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { registerGenerateCommand } from '../src/commands/generate'

describe('kick g — negated flags after the subcommand', () => {
  let dir: string
  let cwd: string

  beforeEach(() => {
    cwd = process.cwd()
    dir = mkdtempSync(join(tmpdir(), 'kick-g-flags-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', type: 'module' }))
    process.chdir(dir)
  })

  afterEach(() => {
    process.chdir(cwd)
    rmSync(dir, { recursive: true, force: true })
  })

  async function run(...args: string[]) {
    const program = new Command().exitOverride()
    registerGenerateCommand(program)
    await program.parseAsync(['node', 'kick', 'g', ...args])
  }

  it('module --no-pluralize keeps the name singular', async () => {
    await run('module', 'auth', '--no-pluralize', '--no-tests')
    expect(existsSync(join(dir, 'src/modules/auth/auth.module.ts'))).toBe(true)
    expect(existsSync(join(dir, 'src/modules/auths'))).toBe(false)
    expect(existsSync(join(dir, 'src/modules/auth/__tests__'))).toBe(false)
  })

  it('module points an in-memory repository at a database, not at itself', async () => {
    await run('module', 'note', '--no-tests')
    const index = readFileSync(join(dir, 'src/modules/note/note.module.ts'), 'utf8')
    expect(index).toContain('Swap in a database by replacing')
  })

  it('module uses the name as typed by default', async () => {
    await run('module', 'note', '--no-tests')
    expect(existsSync(join(dir, 'src/modules/note'))).toBe(true)
    expect(existsSync(join(dir, 'src/modules/notes'))).toBe(false)
  })

  it('module --pluralize pluralizes the folder', async () => {
    await run('module', 'note', '--pluralize', '--no-tests')
    expect(existsSync(join(dir, 'src/modules/notes'))).toBe(true)
  })

  it('scaffold --no-pluralize keeps the name singular', async () => {
    await run('scaffold', 'auth', 'email:string', '--no-pluralize', '--no-tests')
    expect(existsSync(join(dir, 'src/modules/auth'))).toBe(true)
    expect(existsSync(join(dir, 'src/modules/auths'))).toBe(false)
  })

  const mount = (folder: string, file: string) =>
    /path: '([^']+)'/.exec(
      readFileSync(join(dir, 'src/modules', folder, `${file}.module.ts`), 'utf8'),
    )?.[1]

  it('module mounts at the plural of the name, folder as typed', async () => {
    await run('module', 'task', 'user-profile', 'auth', '--no-tests')
    expect(mount('task', 'task')).toBe('/tasks')
    expect(mount('user-profile', 'user-profile')).toBe('/user-profiles')
    expect(mount('auth', 'auth')).toBe('/auth')
  })

  it('module --no-pluralize-routes mounts at the name as typed', async () => {
    await run('module', 'task', '--no-pluralize-routes', '--no-tests')
    expect(mount('task', 'task')).toBe('/task')
  })

  it('modules.pluralizeRoutes: false in kick.config keeps the route as typed', async () => {
    writeFileSync(
      join(dir, 'kick.config.json'),
      JSON.stringify({ modules: { pluralizeRoutes: false } }),
    )
    await run('scaffold', 'task', 'title:string', '--no-tests')
    expect(mount('task', 'task')).toBe('/task')
    await run('module', 'note', '--pluralize-routes', '--no-tests')
    expect(mount('note', 'note')).toBe('/notes')
  })

  it('scaffold mounts at the plural, --pluralize also pluralizes the folder', async () => {
    await run('scaffold', 'invoice', 'amount:number', '--pluralize')
    expect(mount('invoices', 'invoice')).toBe('/invoices')
  })
})
