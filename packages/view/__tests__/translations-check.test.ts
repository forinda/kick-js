/** Checking `t` calls against the catalogues: unknown keys, missing params, missing locales. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from '../src/parse/template'
import { check } from '../src/check/check'
import { BUILTIN_PIPES, OVERRIDABLE_PIPES } from '../src/pipes/builtins'
import { catalogIndex } from '../src/i18n'
import type { Project } from '../src/check/project'
import { loadViewsProject } from '../src/load-project'
import { createViews } from '../src/index'

const index = catalogIndex(
  {
    en: { 'cart.title': 'Cart', 'cart.items': { one: '{count} item', other: '{count} items' } },
    sw: { 'cart.items': { other: 'bidhaa {count}' } },
  },
  'src/views/locales',
)

function diags(src: string, messages: Project['messages'] | null = index) {
  const project: Project = {
    templates: new Map([['page', parse(src, 'page.kick').ast]]),
    pipes: new Set([...BUILTIN_PIPES, ...OVERRIDABLE_PIPES]),
    componentsDir: 'components',
    messages: messages ?? undefined,
  }
  return check('page', project).diagnostics.map((d) => `${d.severity}: ${d.message}`)
}

describe('checking t', () => {
  it('passes a known key with its params', () => {
    expect(diags("{{ 'cart.items' | t:'count':n }}")).toEqual([])
  })

  it('reports an unknown key', () => {
    expect(diags("{{ 'cart.nope' | t }}")).toEqual(["error: unknown message 'cart.nope'"])
  })

  it('warns about a key some locales lack', () => {
    expect(diags("{{ 'cart.title' | t }}")).toEqual(["warning: 'cart.title' is missing from sw"])
  })

  it('reports a placeholder the call does not pass', () => {
    expect(diags("{{ 'cart.items' | t }}")).toEqual([
      "error: message 'cart.items' needs 'count': t:'count':value",
    ])
  })

  it('reports params that are not name/value pairs', () => {
    expect(diags("{{ 'cart.items' | t:'count' }}")).toEqual([
      "error: t takes name/value pairs: t:'count':n",
    ])
  })

  it("leaves dynamic keys and names alone, and doesn't check without catalogues", () => {
    expect(diags('{{ item.key | t }}')).toEqual([])
    expect(diags("{{ 'cart.items' | t:name:n }}")).toEqual([])
    expect(diags("{{ 'nope' | t }}", null)).toEqual([])
  })

  it('asks for catalogues when the folder is empty or missing', () => {
    expect(diags("{{ 'a' | t }}", catalogIndex({}, 'src/views/locales'))).toEqual([
      'error: t needs message catalogues: src/views/locales/<locale>.json',
    ])
  })
})

describe('projects with catalogues', () => {
  const project = (files: Record<string, string>) => {
    const root = mkdtempSync(join(tmpdir(), 'kick-tcheck-'))
    for (const [f, text] of Object.entries(files)) {
      mkdirSync(join(root, f, '..'), { recursive: true })
      writeFileSync(join(root, f), text)
    }
    return root
  }

  it('loadViewsProject checks against src/views/locales, unless the app has its own t', async () => {
    const files = {
      'src/views/page.kick': "{{ 'nope' | t }}",
      'src/views/locales/en.json': '{ "hi": "Hi" }',
    }
    const loaded = await loadViewsProject({ root: project(files) })
    const page = check('page', loaded.project).diagnostics.map((d) => d.message)
    expect(page).toEqual(["unknown message 'nope'"])

    const own = await loadViewsProject({
      root: project({ ...files, 'src/views/pipes.ts': 'export const t = (k: string) => k' }),
    })
    expect(check('page', own.project).diagnostics).toEqual([])
  })

  it('reports a broken catalogue', async () => {
    const loaded = await loadViewsProject({
      root: project({ 'src/views/page.kick': '<p></p>', 'src/views/locales/en.json': '{' }),
    })
    expect(loaded.diagnostics.map((x) => x.d.message).join()).toMatch(/en\.json/)
  })

  it('createViews refuses a page with an unknown key', async () => {
    const v = createViews({
      loader: { list: async () => ['page'], read: async () => "{{ 'nope' | t }}" },
      messages: { en: { hi: 'Hi' } },
    })
    await expect(v.render('page')).rejects.toThrow(/unknown message 'nope'/)
  })
})
