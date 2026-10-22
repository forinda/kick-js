import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  FLASH_KEY,
  FORM_ERRORS_KEY,
  OLD_INPUT_KEY,
  PREVIOUS_URL_KEY,
  SECRET_FIELD,
} from '@forinda/kickjs'
import { render } from '../src/render/render'
import { createViews } from '../src/index'
import { check } from '../src/check/check'
import { parse } from '../src/parse/template'
import { BUILTIN_PIPES } from '../src/pipes/builtins'

function dir(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'kick-form-'))
  for (const [name, src] of Object.entries(files)) {
    const file = join(root, `${name}.kick`)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, src)
  }
  return root
}

const sessionCtx = () => ({
  session: {
    data: {
      __inertia_flash: { success: 'Saved' },
      __inertia_errors: { title: 'Too short' },
      __kick_old: { title: 'a' },
    } as Record<string, unknown>,
  },
})

describe('form state', () => {
  it('takes form state from the session once', async () => {
    const views = createViews({
      viewsDir: dir({ page: '{{ $flash.success }}|{{ $errors.title }}|{{ $old.title }}' }),
      warn: vi.fn(),
    })
    const ctx = sessionCtx()
    expect(await views.render('page', {}, { ctx })).toBe('Saved|Too short|a')
    expect(await views.render('page', {}, { ctx })).toBe('||')
  })

  it("a re-render's own state wins", async () => {
    const views = createViews({ viewsDir: dir({ page: '{{ $errors.title }}' }), warn: vi.fn() })
    expect(await views.render('page', { $errors: { title: 'Mine' } }, { ctx: sessionCtx() })).toBe(
      'Mine',
    )
  })

  it('renders without a request', async () => {
    const views = createViews({
      viewsDir: dir({ page: '[{{ $errors.title }}]' }),
      strict: true,
      warn: vi.fn(),
    })
    expect(await views.render('page', {})).toBe('[]')
  })

  it('components read request-wide form state', async () => {
    const files = {
      'components/form-field': '@input name\n<p>{{ $errors[name] }}</p>',
      page: '<form-field name="title" />',
    }
    const views = createViews({ viewsDir: dir(files), warn: vi.fn() })
    expect(await views.render('page', {}, { ctx: sessionCtx() })).toContain('<p>Too short</p>')

    const templates = new Map(
      Object.entries(files).map(([n, src]) => [n, parse(src, `${n}.kick`).ast]),
    )
    const project = { templates, pipes: new Set(BUILTIN_PIPES), componentsDir: 'components' }
    const messages = check('components/form-field', project).diagnostics.map((d) => d.message)
    expect(messages.join('\n')).not.toContain("isn't an input")
  })

  it("the session keys match core's", async () => {
    const { FORM_STATE_KEYS } = await import('../src/form-state')
    expect(FORM_STATE_KEYS).toEqual({
      flash: FLASH_KEY,
      errors: FORM_ERRORS_KEY,
      old: OLD_INPUT_KEY,
      previous: PREVIOUS_URL_KEY,
    })
    const { SECRET_FIELD: viewSecret } = await import('../src/form-state')
    expect(viewSecret.source).toBe(SECRET_FIELD.source)
  })
})

describe('@error', () => {
  const page = (src: string) => createViews({ viewsDir: dir({ page: src }), warn: vi.fn() })
  it("@error shows the field's message", async () => {
    const views = page('@error(\'title\') {\n<p class="e">{{ $message }}</p>\n}')
    expect(await views.render('page', { $errors: { title: 'Too short' } })).toContain(
      '<p class="e">Too short</p>',
    )
    expect(await views.render('page', { $errors: {} })).not.toContain('<p')
  })
  it("@error('form') shows a form-level error", async () => {
    const views = page("@error('form') {{{ $message }}}")
    expect(await views.render('page', { $errors: { form: 'Bad' } })).toBe(
      '<span data-kick-error="form" aria-live="polite">Bad</span>',
    )
  })
  it('@error needs a string', () => {
    const r = parse('@error(title) {}', 'p.kick')
    expect(r.diagnostics.map((d) => d.message).join('\n')).toContain('@error')
  })
})

describe('refill from $old', () => {
  const FORM = [
    '<input name="title">',
    '<textarea name="bio"></textarea>',
    '<select name="kind"><option value="a">A</option><option value="b">B</option></select>',
    '<input type="checkbox" name="agree">',
    '<input type="radio" name="size" value="m">',
  ].join('\n')
  const page = (src: string) => createViews({ viewsDir: dir({ page: src }), warn: vi.fn() })

  it('refills inputs, textareas, selects, checkboxes and radios', async () => {
    const views = page(FORM)
    const html = await views.render('page', {
      $old: { title: 'Hi', bio: 'Me', kind: 'b', agree: 'on', size: 'm' },
    })
    expect(html).toContain('value="Hi"')
    expect(html).toContain('>\nMe</textarea>')
    expect(html).toContain('<option value="b" selected>')
    expect(html).toContain('name="agree" checked')
    expect(html).toContain('value="m" checked')
    const empty = await views.render('page', { $old: {} })
    for (const s of ['selected', 'checked', 'value="Hi"']) expect(empty).not.toContain(s)
  })

  it('escapes refilled values', async () => {
    const html = await page('<input name="title">').render('page', {
      $old: { title: '"><script>' },
    })
    expect(html).toContain('value="&quot;&gt;&lt;script&gt;"')
  })

  it('never overrides an explicit value or fills secrets', async () => {
    const html = await page(
      [
        '<input name="title" value="Fixed">',
        '<input type="password" name="pw">',
        '<input name="api_token">',
        '<input type="hidden" name="id" value="7">',
      ].join('\n'),
    ).render('page', { $old: { title: 'x', pw: 'p', api_token: 't', id: '9' } })
    expect(html).toContain('value="Fixed"')
    expect(html).toContain('<input type="password" name="pw">')
    expect(html).toContain('<input name="api_token">')
    expect(html).toContain('value="7"')
    expect(html).not.toContain('value="9"')
  })
})

describe('review fixes', () => {
  const page = (src: string) => createViews({ viewsDir: dir({ page: src }), warn: vi.fn() })

  it('remembers the last full page a GET rendered, for going back', async () => {
    const views = page('<p></p>')
    const ctx = (method: string, url: string) => ({
      req: { method, url, originalUrl: url },
      session: { data: {} as Record<string, unknown> },
    })
    const get = ctx('GET', '/products/new?step=2')
    await views.render('page', {}, { ctx: get })
    expect(get.session.data.__inertia_previous).toBe('/products/new?step=2')
    const partial = ctx('GET', '/rows')
    await views.render('page', {}, { ctx: partial, layout: false })
    expect(partial.session.data.__inertia_previous).toBeUndefined()
    const post = ctx('POST', '/products')
    await views.render('page', {}, { ctx: post })
    expect(post.session.data.__inertia_previous).toBeUndefined()
  })

  it('never refills a control whose type is bound, or short password names', async () => {
    const html = await page(
      '<input [type]="show ? \'text\' : \'password\'" name="secretish">\n<input name="pwd">\n<input name="pin">',
    ).render('page', { show: true, $old: { secretish: 'hunter2', pwd: 'p', pin: '1' } })
    expect(html).not.toContain('hunter2')
    expect(html).not.toContain('value="p"')
    expect(html).not.toContain('value="1"')
  })

  it('render() on its own works for templates with named inputs', () => {
    const ast = parse('<input name="title">', 'p.kick').ast
    const project = {
      templates: new Map([['p', ast]]),
      pipes: new Set(BUILTIN_PIPES),
      componentsDir: 'components',
    }
    const t = check('p', project).template!
    expect(
      render(
        t,
        {},
        {
          locale: 'en-US',
          timeZone: 'UTC',
          strict: true,
          pipes: {},
          warn: vi.fn(),
          resolve: () => t,
        },
      ),
    ).toBe('<input name="title">')
  })

  it('refills options and checkboxes with dynamic values, in loops and ifs', async () => {
    const views = page(
      [
        '<select name="cat">',
        '  @if (true) { <option value="">Pick</option> }',
        '  @for (c of cats; track c.id) { <option value="{{ c.id }}">{{ c.name }}</option> }',
        '  <option value="other">Other</option>',
        '</select>',
        '@for (t of tags; track t) { <input type="radio" name="tag" value="{{ t }}"> }',
      ].join('\n'),
    )
    const html = await views.render('page', {
      cats: [
        { id: '1', name: 'A' },
        { id: '2', name: 'B' },
      ],
      tags: ['x', 'y'],
      $old: { cat: '2', tag: 'y' },
    })
    expect(html).toContain('<option value="2" selected>')
    expect(html).not.toContain('<option value="1" selected>')
    expect(html).toContain('value="y" checked')
    // Numeric ids: the submitted value is the string '2'.
    const numeric = await views.render('page', {
      cats: [
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
      ],
      tags: [],
      $old: { cat: '2' },
    })
    expect(numeric).toContain('<option value="2" selected>')
    const other = await views.render('page', { cats: [], tags: [], $old: { cat: 'other' } })
    expect(other).toContain('<option value="other" selected>')
  })
})

describe('review: refill details', () => {
  const page = (src: string, opts = {}) =>
    createViews({ viewsDir: dir({ page: src }), warn: vi.fn(), ...opts })

  it("keeps a refilled textarea's leading newline", async () => {
    const html = await page('<textarea name="bio"></textarea>').render('page', {
      $old: { bio: '\nindented' },
    })
    // The parser drops one newline after <textarea>: ours, not the value's.
    expect(html).toBe('<textarea name="bio">\n\nindented</textarea>')
  })

  it('compares written values the way the browser sends them', async () => {
    const html = await page(
      '<select name="v"><option value="a&amp;b">A</option></select><input type="checkbox" name="c" value="x&lt;y">',
    ).render('page', { $old: { v: 'a&b', c: 'x<y' } })
    expect(html).toContain('<option value="a&amp;b" selected>')
    expect(html).toContain('checked')
  })

  it('keeps form values share() gives when the session has none', async () => {
    const views = page('{{ $flash.info }}', { share: () => ({ $flash: { info: 'From share' } }) })
    expect(await views.render('page', {}, { ctx: { session: { data: {} } } })).toBe('From share')
    expect(
      await views.render(
        'page',
        {},
        { ctx: { session: { data: { __inertia_flash: { info: 'From session' } } } } },
      ),
    ).toBe('From session')
  })
})
