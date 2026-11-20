/** Message catalogues: flattening, plurals, fallback. */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createTranslator, flattenCatalog, placeholders, readCatalogs } from '../src/i18n'

const en = flattenCatalog(
  {
    cart: {
      title: 'Cart',
      items: { zero: 'No items', one: '{count} item', other: '{count} items' },
      hi: 'Hello {name}',
    },
  },
  'en.json',
)

describe('flattenCatalog', () => {
  it('flattens nested keys and keeps plural objects', () => {
    expect(Object.keys(en).toSorted()).toEqual(['cart.hi', 'cart.items', 'cart.title'])
    expect(en['cart.items']).toEqual({
      zero: 'No items',
      one: '{count} item',
      other: '{count} items',
    })
  })

  it('names the file and key on a bad entry', () => {
    expect(() => flattenCatalog({ a: { one: 'x' } }, 'sw.json')).toThrow(/sw\.json.*a.*other/)
    expect(() => flattenCatalog({ a: 1 }, 'sw.json')).toThrow(/sw\.json.*'a'/)
    expect(() => flattenCatalog([], 'sw.json')).toThrow(/sw\.json/)
  })

  it('lists placeholders across forms', () => {
    expect([...placeholders(en['cart.items']!)]).toEqual(['count'])
    expect([...placeholders('{a} and {b}')]).toEqual(['a', 'b'])
  })
})

describe('createTranslator', () => {
  const sw = { 'cart.title': 'Kikapu' }
  const warn = vi.fn()
  const t = createTranslator({ en, sw }, { defaultLocale: 'en', warn })

  it('fills params and picks plural forms', () => {
    expect(t('en-US', 'cart.items', { count: 1 })).toBe('1 item')
    expect(t('en-US', 'cart.items', { count: 1024 })).toBe('1,024 items')
    expect(t('en-US', 'cart.items', { count: 0 })).toBe('No items')
    expect(t('en', 'cart.hi', { name: 'Ann' })).toBe('Hello Ann')
  })

  it('falls back by language, then the default locale, then the key', () => {
    expect(t('sw-KE', 'cart.title')).toBe('Kikapu')
    expect(t('sw-KE', 'cart.items', { count: 2 })).toBe('2 items')
    expect(createTranslator({ zh: { a: '甲' } }, { defaultLocale: 'en' })('zh-Hant-TW', 'a')).toBe(
      '甲',
    )
    warn.mockClear()
    expect(t('fr', 'nope')).toBe('nope')
    expect(t('fr', 'nope')).toBe('nope')
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("doesn't throw on a locale Intl refuses", () => {
    expect(t('en_bad!', 'cart.items', { count: 2 })).toBe('2 items')
  })

  it('leaves a missing param as written', () => {
    expect(t('en', 'cart.hi')).toBe('Hello {name}')
  })
})

describe('readCatalogs', () => {
  it('reads every locale file, and names a broken one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kick-i18n-'))
    mkdirSync(join(dir, 'locales'))
    writeFileSync(join(dir, 'locales/en.json'), '{ "a": "A" }')
    expect(await readCatalogs(join(dir, 'locales'))).toEqual({ en: { a: 'A' } })
    writeFileSync(join(dir, 'locales/sw.json'), '{ "a": ')
    await expect(readCatalogs(join(dir, 'locales'))).rejects.toThrow(/sw\.json/)
    expect(await readCatalogs(join(dir, 'missing'))).toBeUndefined()
  })
})
