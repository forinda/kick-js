/** Follow-ups to the pipes and translations work. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parse } from '../src/parse/template'
import { check } from '../src/check/check'
import {
  BUILTIN_PIPES,
  OVERRIDABLE_PIPES,
  builtinPipes,
  formatterCacheSize,
} from '../src/pipes/builtins'
import { catalogIndex } from '../src/i18n'
import type { Project } from '../src/check/project'
import { createViews } from '../src/index'
import * as fileLoader from '../src/loaders/file'

vi.mock('../src/loaders/file', async (orig) => {
  const mod = await orig<typeof import('../src/loaders/file')>()
  return { ...mod, readCatalogs: vi.fn(mod.readCatalogs) }
})

function diags(src: string) {
  const project: Project = {
    templates: new Map([['page', parse(src, 'page.kick').ast]]),
    pipes: new Set([...BUILTIN_PIPES, ...OVERRIDABLE_PIPES]),
    componentsDir: 'components',
    messages: catalogIndex({ en: { n: { one: 'One', other: 'Many' } } }, 'locales'),
  }
  return check('page', project).diagnostics.map((d) => `${d.severity}: ${d.message}`)
}

function app(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'kick-i18n-minors-'))
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true })
    writeFileSync(join(dir, name), text)
  }
  return dir
}

describe('pipes and translations follow-ups', () => {
  it('a plural message needs count even without {count}', () => {
    expect(diags("{{ 'n' | t }}")).toEqual(["error: message 'n' needs 'count': t:'count':value"])
    expect(diags("{{ 'n' | t:'count':2 }}")).toEqual([])
  })

  it('pipes.ts can replace the default pipe with export { x as default }', async () => {
    const dir = app({
      'page.kick': "{{ x | default:'y' }}",
      'pipes.ts': "const fallback = () => 'APP'\nexport { fallback as default }\n",
    })
    const v = createViews({ viewsDir: dir, pipesFile: join(dir, 'pipes.ts') })
    expect(await v.render('page', { x: 'set' })).toBe('APP')
  })

  it('warns about nl2br in an attribute', () => {
    expect(diags('<p title="{{ a | nl2br }}"></p>')).toEqual([
      'warning: nl2br makes HTML, which an attribute shows as text — use it in text: <p>{{ a | nl2br }}</p>',
    ])
    expect(diags('<p>{{ a | nl2br }}</p>')).toEqual([])
    // Nested under another pipe, still in the attribute.
    expect(diags(`<p title="{{ a | nl2br | default:'' }}"></p>`)).toEqual([
      'warning: nl2br makes HTML, which an attribute shows as text — use it in text: <p>{{ a | nl2br }}</p>',
    ])
  })

  it('plural and ago reuse their Intl objects', () => {
    const p = builtinPipes({ locale: 'fr-CA', timeZone: 'UTC' })
    const before = formatterCacheSize()
    p.plural!(2, 'item', 'items')
    p.ago!(new Date(Date.now() - 60_000))
    expect(formatterCacheSize() - before).toBe(3) // plural rules, number format, relative time
    p.plural!(3, 'item', 'items')
    p.ago!(new Date(Date.now() - 120_000))
    expect(formatterCacheSize() - before).toBe(3)
  })

  it('a dev render reads the catalogues once', async () => {
    const dir = app({ 'page.kick': "{{ 'hi' | t }}", 'locales/en.json': '{ "hi": "Hi" }' })
    const v = createViews({ viewsDir: dir, pipes: {}, dev: true })
    const read = vi.mocked(fileLoader.readCatalogs)
    read.mockClear()
    expect(await v.render('page')).toBe('Hi')
    expect(read).toHaveBeenCalledTimes(1)
    await v.render('page')
    expect(read).toHaveBeenCalledTimes(2)
    // An edit: detected by one read, which the reload reuses.
    writeFileSync(join(dir, 'locales/en.json'), '{ "hi": "Hello" }')
    expect(await v.render('page')).toBe('Hello')
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('warns about missing keys in dev only', async () => {
    const warn = vi.fn()
    const dir = app({ 'page.kick': '{{ k | t }}', 'locales/en.json': '{ "hi": "Hi" }' })
    await createViews({ viewsDir: dir, pipes: {}, dev: false, warn }).render('page', { k: 'nope' })
    expect(warn).not.toHaveBeenCalled()
    await createViews({ viewsDir: dir, pipes: {}, dev: true, warn }).render('page', { k: 'nope' })
    expect(warn).toHaveBeenCalledWith("no message 'nope' for en-US")
  })
})
