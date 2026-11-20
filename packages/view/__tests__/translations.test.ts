/** The `t` pipe and `views.t`: catalogues given, read from disk, or overridden. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createViews } from '../src/index'
import { builtinPipes } from '../src/pipes/builtins'

const messages = {
  en: {
    'cart.title': 'Cart',
    'cart.items': { one: '{count} item', other: '{count} items' },
    bold: '<b>{name}</b>',
  },
  sw: { 'cart.title': 'Kikapu', 'cart.items': { one: 'bidhaa {count}', other: 'bidhaa {count}' } },
}

const views = (pages: Record<string, string>, more = {}) =>
  createViews({
    loader: { list: async () => Object.keys(pages), read: async (n) => pages[n]! },
    messages,
    locale: 'en',
    ...more,
  })

describe('t pipe', () => {
  it('translates with name/value params, per render locale', async () => {
    const v = views({ page: "{{ 'cart.items' | t:'count':n }}" })
    expect(await v.render('page', { n: 2 })).toBe('2 items')
    expect(await v.render('page', { n: 2 }, { locale: 'sw' })).toBe('bidhaa 2')
  })

  it('works in an attribute', async () => {
    const v = views({ page: `<a title="{{ 'cart.title' | t }}"></a>` })
    expect(await v.render('page', {}, { locale: 'sw' })).toBe('<a title="Kikapu"></a>')
  })

  it('escapes the message and its params', async () => {
    const v = views({ page: "{{ 'bold' | t:'name':who }}" })
    expect(await v.render('page', { who: '<i>' })).toBe('&lt;b&gt;&lt;i&gt;&lt;/b&gt;')
  })

  it('ignores a dangling param name at render (the check reports it)', () => {
    const translate = vi.fn((k: string) => k)
    builtinPipes({ locale: 'en', timeZone: 'UTC', translate }).t!('cart.title', 'count')
    expect(translate).toHaveBeenCalledWith('cart.title', {})
    expect(builtinPipes({ locale: 'en', timeZone: 'UTC' }).t!('x.y')).toBe('x.y')
  })

  it('prints the key, and warns, for a key no catalogue has', async () => {
    const warn = vi.fn()
    const v = views({ page: '{{ key | t }}' }, { warn })
    expect(await v.render('page', { key: 'x.y' })).toBe('x.y')
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/x\.y/))
  })

  it("uses the app's own t when it exports one", async () => {
    const v = views({ page: "{{ 'x' | t }}" }, { pipes: { t: (k: unknown) => `T:${String(k)}` } })
    expect(await v.render('page')).toBe('T:x')
  })
})

describe('views.t', () => {
  it('translates outside templates', async () => {
    const v = views({})
    expect(await v.t('cart.items', { count: 1 })).toBe('1 item')
    expect(await v.t('cart.title', {}, { locale: 'sw-KE' })).toBe('Kikapu')
  })
})

describe('catalogues on disk', () => {
  it('reads <viewsDir>/locales/*.json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kick-t-'))
    mkdirSync(join(dir, 'locales'))
    writeFileSync(join(dir, 'page.kick'), "{{ 'hi' | t:'name':name }}")
    writeFileSync(join(dir, 'locales/en-US.json'), '{ "hi": "Hello {name}" }')
    const v = createViews({ viewsDir: dir, pipes: {} })
    expect(await v.render('page', { name: 'Ann' })).toBe('Hello Ann')
  })
})
