import { describe, expect, it } from 'vitest'
import {
  escapeHtml,
  escapeJsonForScript,
  isUrlAttr,
  read,
  safeStyleValue,
  sanitizeSrcset,
  sanitizeUrl,
} from '../src/render/safe'

describe('safety primitives', () => {
  it('read hides functions and forbidden names', () => {
    expect(read({}, 'toString')).toBeUndefined()
    expect(read({}, 'constructor')).toBeUndefined()
    expect(read([], '__proto__')).toBeUndefined()
    expect(read({ f() {} }, 'f')).toBeUndefined()
    expect(read({ a: 1 }, '__lookupGetter__')).toBeUndefined()
    expect(read(new Map([[1, 2]]), 'size')).toBe(1)
    expect(
      read(
        {
          get g() {
            return 5
          },
        },
        'g',
      ),
    ).toBe(5)
    expect(read([1, 2], 1)).toBe(2)
    expect(read([1, 2], 'length')).toBe(2)
    expect(read(null, 'a')).toBeUndefined()
    expect(read(undefined, 'a')).toBeUndefined()
    expect(read('abc', 'length')).toBe(3)
  })

  it('escapes', () => {
    expect(escapeHtml('<a href="x">&\'')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;')
  })

  it('leaves non-ASCII alone', () => {
    const s = 'héllo 👋 مرحبا á'
    expect(escapeHtml(s)).toBe(s)
  })

  it('sanitizes URLs', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:x',
      'java\tscript:x',
      'java\nscript:x',
      '\u0001javascript:x',
      '  javascript:x',
      'data:text/html,x',
      'vbscript:x',
    ]) {
      expect(sanitizeUrl(bad), JSON.stringify(bad)).toBe('#')
    }
    for (const good of [
      '/a',
      'a/b',
      '?q',
      '#h',
      'https://x',
      'HTTP://x',
      'mailto:a@b.c',
      'tel:+1',
      '',
      'a:b/c?x=y:z'.slice(4),
    ]) {
      expect(sanitizeUrl(good), good).toBe(good)
    }
    expect(sanitizeSrcset('a.png 1x, javascript:x 2x')).toBe('a.png 1x, # 2x')
    expect(sanitizeSrcset('a.png, b.png 640w')).toBe('a.png, b.png 640w')
  })

  it('url attrs', () => {
    for (const [tag, attr] of [
      ['a', 'href'],
      ['object', 'data'],
      ['svg', 'xlink:href'],
      ['base', 'href'],
      ['link', 'href'],
      ['a', 'ping'],
      ['blockquote', 'cite'],
      ['img', 'srcset'],
      ['form', 'action'],
      ['button', 'formaction'],
      ['video', 'poster'],
      ['embed', 'src'],
    ]) {
      expect(isUrlAttr(tag!, attr!), `${tag} ${attr}`).toBe(true)
    }
    expect(isUrlAttr('div', 'data')).toBe(false)
    expect(isUrlAttr('a', 'title')).toBe(false)
  })

  it('json', () => {
    const raw = JSON.stringify('</script><!--\u2028\u2029&>')
    const out = escapeJsonForScript(raw)
    for (const bad of ['</script', '<!--', '\u2028', '\u2029', '<', '>', '&']) {
      expect(out.includes(bad), bad).toBe(false)
    }
    expect(JSON.parse(out)).toBe('</script><!--\u2028\u2029&>')
  })

  it('style values', () => {
    expect(safeStyleValue('10px')).toBe('10px')
    expect(safeStyleValue('red')).toBe('red')
    expect(safeStyleValue('rgb(0, 0, 0)')).toBe('rgb(0, 0, 0)')
    for (const bad of [
      'red;x:y',
      'url(x)',
      'URL(x)',
      'expression(x)',
      'a{b}',
      'a\\b',
      '"x"',
      "'x'",
      '/*x*/',
      '<x',
    ]) {
      expect(safeStyleValue(bad), bad).toBeUndefined()
    }
  })
})
