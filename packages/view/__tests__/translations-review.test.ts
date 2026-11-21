/** Review fixes: prototype keys, dev catalogue edits, truncate without a length. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createViews } from '../src/index'
import { createTranslator } from '../src/i18n'
import { builtinPipes } from '../src/pipes/builtins'

describe('translation review fixes', () => {
  it("treats a prototype member's name as an unknown key", () => {
    const t = createTranslator({ en: { hi: 'Hi' } }, { defaultLocale: 'en' })
    for (const key of ['constructor', 'toString', 'hasOwnProperty', '__proto__'])
      expect(t('en', key)).toBe(key)
    expect(t('constructor', 'hi')).toBe('Hi')
  })

  it('re-checks templates in dev when a catalogue changes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kick-t-dev-'))
    mkdirSync(join(dir, 'locales'))
    writeFileSync(join(dir, 'page.kick'), "{{ 'cart.new' | t }}")
    writeFileSync(join(dir, 'locales/en.json'), '{ "cart": { "old": "Old" } }')
    const v = createViews({ viewsDir: dir, pipes: {}, dev: true })
    await expect(v.render('page')).rejects.toThrow(/unknown message 'cart.new'/)
    writeFileSync(join(dir, 'locales/en.json'), '{ "cart": { "new": "New" } }')
    expect(await v.render('page')).toBe('New')
  })

  it('truncate without a usable length keeps the text', () => {
    const p = builtinPipes({ locale: 'en', timeZone: 'UTC' })
    expect(p.truncate!('abc')).toBe('abc')
    expect(p.truncate!('abc', -1)).toBe('abc')
    expect(p.truncate!('abc', 'x')).toBe('abc')
  })
})
