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
    const index = readFileSync(join(dir, 'src/modules/notes/note.module.ts'), 'utf8')
    expect(index).toContain('Swap in a database by replacing')
  })

  it('scaffold --no-pluralize keeps the name singular', async () => {
    await run('scaffold', 'auth', 'email:string', '--no-pluralize', '--no-tests')
    expect(existsSync(join(dir, 'src/modules/auth'))).toBe(true)
    expect(existsSync(join(dir, 'src/modules/auths'))).toBe(false)
  })
})
