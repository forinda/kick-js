import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { FLASH_KEY, FORM_ERRORS_KEY, OLD_INPUT_KEY } from '@forinda/kickjs'
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
    })
  })
})
