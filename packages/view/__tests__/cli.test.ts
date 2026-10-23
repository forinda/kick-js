import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Command } from 'commander'
import { checkViews, fmtViews, viewCliPlugin } from '../src/cli'

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'kick-view-cli-'))
  for (const [name, src] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), src)
  }
  return root
}

describe('kick fmt:views / check:views', () => {
  it('fmt:views --check exits 1 when a file would change, and writes nothing', async () => {
    const root = project({
      'src/views/a.kick': '@if(a){\n<p>x</p>\n}\n',
      'src/views/b.kick': '<p>ok</p>\n',
    })
    const log = vi.fn()
    expect(await fmtViews({ root, check: true, log })).toBe(1)
    expect(readFileSync(join(root, 'src/views/a.kick'), 'utf8')).toBe('@if(a){\n<p>x</p>\n}\n')
    expect(log.mock.calls.flat().join('\n')).toContain('a.kick')
  })

  it('fmt:views writes, then --check passes', async () => {
    const root = project({ 'src/views/a.kick': '@if(a){\n<p>x</p>\n}\n' })
    expect(await fmtViews({ root, log: vi.fn() })).toBe(0)
    expect(readFileSync(join(root, 'src/views/a.kick'), 'utf8')).toBe('@if (a) {\n  <p>x</p>\n}\n')
    expect(await fmtViews({ root, check: true, log: vi.fn() })).toBe(0)
  })

  it('check:views reports errors with positions and exits 1', async () => {
    const root = project({
      'src/views/bad.kick': '<p>\n{{ x | nope }}</p>',
      'src/views/good.kick': '{{ x | initials }}',
      'src/views/pipes.ts': 'export const initials = (v: string) => v[0]',
    })
    const log = vi.fn()
    expect(await checkViews({ root, log })).toBe(1)
    const out = log.mock.calls.flat().join('\n')
    expect(out).toContain('bad.kick:2:')
    expect(out).toContain("unknown pipe 'nope'")
    expect(out).not.toContain('good.kick')
  })

  it('check:views reads validators.ts', async () => {
    const page = { 'src/views/a.kick': '<input name="p" validate="phone">' }
    expect(await checkViews({ root: project(page), log: vi.fn() })).toBe(1)
    const root = project({
      ...page,
      'src/views/validators.ts': "export const phone = (v: string) => (v ? undefined : 'x')",
    })
    expect(await checkViews({ root, log: vi.fn() })).toBe(0)
    const other = project({
      ...page,
      'lib/checks.ts': "export const phone = (v: string) => (v ? undefined : 'x')",
    })
    expect(await checkViews({ root: other, validatorsFile: 'lib/checks.ts', log: vi.fn() })).toBe(0)
  })

  it('check:views reports a built-in name in validators.ts', async () => {
    const root = project({
      'src/views/a.kick': '<p></p>',
      'src/views/validators.ts': 'export const email = () => undefined',
    })
    const log = vi.fn()
    expect(await checkViews({ root, log })).toBe(1)
    expect(log.mock.calls.flat().join('\n')).toContain("'email' is a built-in validator")
  })

  it('check:views passes a clean project', async () => {
    const root = project({ 'src/views/a.kick': '<p>{{ x }}</p>' })
    expect(await checkViews({ root, log: vi.fn() })).toBe(0)
  })

  it('runs through a real commander program', async () => {
    const root = project({ 'src/views/a.kick': '@if(a){\n<p>x</p>\n}\n' })
    const log = vi.fn()
    const program = new Command().exitOverride()
    await viewCliPlugin.register!(program, { cwd: root, projectRoot: root, config: null, log })
    process.exitCode = 0
    await program.parseAsync(['node', 'kick', 'fmt:views', '--check'])
    expect(process.exitCode).toBe(1)
    await program.parseAsync(['node', 'kick', 'fmt:views'])
    await program.parseAsync(['node', 'kick', 'check:views'])
    expect(process.exitCode).toBe(0)
    expect(readFileSync(join(root, 'src/views/a.kick'), 'utf8')).toBe('@if (a) {\n  <p>x</p>\n}\n')
    process.exitCode = 0
  })
})
