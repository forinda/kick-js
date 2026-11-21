/** PR review fixes: inline messages checked, `__proto__` keys, cache: false, loaders without version(). */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createViews } from '../src/index'
import { createTranslator, flattenCatalog } from '../src/i18n'

function app(page: string, en: string) {
  const dir = mkdtempSync(join(tmpdir(), 'kick-t-pr-'))
  mkdirSync(join(dir, 'locales'))
  writeFileSync(join(dir, 'page.kick'), page)
  writeFileSync(join(dir, 'locales/en.json'), en)
  return dir
}

describe('translation PR review fixes', () => {
  it('refuses inline plural messages without other', () => {
    expect(() =>
      createViews({ pipes: {}, messages: { en: { n: { one: 'One' } } } as never }),
    ).toThrow(/'n' has plural forms but no 'other'/)
  })

  it('keeps a __proto__ catalogue key', () => {
    const en = flattenCatalog(JSON.parse('{"__proto__":"Translated"}'), 'en.json')
    expect(createTranslator({ en }, { defaultLocale: 'en' })('en', '__proto__')).toBe('Translated')
  })

  it('re-reads catalogues on every render with cache: false', async () => {
    const dir = app("{{ 'hi' | t }}", '{ "hi": "Hi" }')
    const v = createViews({ viewsDir: dir, pipes: {}, dev: false, cache: false })
    expect(await v.render('page')).toBe('Hi')
    writeFileSync(join(dir, 'locales/en.json'), '{ "hi": "Hello" }')
    expect(await v.render('page')).toBe('Hello')
  })

  it('re-checks a catalogue edit in dev with a loader that has no version()', async () => {
    const dir = app('', '{ "old": "Old" }')
    const loader = { list: async () => ['page'], read: async () => "{{ 'new' | t }}" }
    const v = createViews({ viewsDir: dir, loader, pipes: {}, dev: true })
    await expect(v.render('page')).rejects.toThrow(/unknown message 'new'/)
    writeFileSync(join(dir, 'locales/en.json'), '{ "new": "New" }')
    expect(await v.render('page')).toBe('New')
  })
})
