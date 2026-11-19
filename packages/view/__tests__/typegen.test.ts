import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parse } from '../src/parse/template'
import { check } from '../src/check/check'
import { BUILTIN_PIPES } from '../src/pipes/builtins'
import { renderViewTypes, viewsTypegen } from '../src/typegen'
import { kickViewsCli } from '../src/cli'

function summaries(files: Record<string, string>) {
  const project = {
    templates: new Map(Object.entries(files).map(([n, s]) => [n, parse(s, `${n}.kick`).ast])),
    pipes: new Set(BUILTIN_PIPES),
    componentsDir: 'components',
  }
  return Object.keys(files)
    .filter((n) => !n.startsWith('components/'))
    .map((n) => ({ name: n, file: `src/views/${n}.kick`, summary: check(n, project).data! }))
}

const root = '/app'
const opts = {
  modules: ['@forinda/kickjs', '@forinda/kickjs-view'],
  outDir: '/app/.kickjs/types',
  projectRoot: root,
}

describe('renderViewTypes', () => {
  it('writes one KickViews block per installed package, typed from each page', () => {
    const out = renderViewTypes(
      summaries({
        'users/show':
          "@import type { User } from '../../domain/user'\n@input user: User\n@input title: string = 'Home'\n@for (p of posts; track p.id) {@fragment('row') {<li>{{ p.title }}</li>}}\n@if (me) { {{ me.name }} }",
        home: '<p>{{ greeting }}</p>',
      }),
      opts,
    )
    expect(out).toContain("declare module '@forinda/kickjs' {")
    expect(out).toContain("declare module '@forinda/kickjs-view' {")
    expect(out).toContain('// from src/views/users/show.kick')
    expect(out).toContain("'users/show': {")
    expect(out).toContain('user: User')
    expect(out).toContain('title?: string')
    expect(out).toContain('posts: Iterable<{ title: unknown }> | null | undefined')
    expect(out).toContain('me?: { name: unknown } | null | undefined')
    expect(out).toContain('row: { p: { title: unknown } }')
    expect(out).toContain('home: {\n      data: { greeting: unknown }')
    expect(out).toContain('export {}')
  })

  it('rewrites a relative @import type from the template to the generated file', () => {
    const out = renderViewTypes(
      summaries({
        'users/show':
          "@import type { User } from '../../domain/user'\n@import type { T } from '@/t'\n<p></p>",
      }),
      opts,
    )
    expect(out).toContain("import type { User } from '../../src/domain/user'")
    expect(out).toContain("import type { T } from '@/t'")
  })

  it('augments only the packages given', () => {
    const out = renderViewTypes(summaries({ a: '{{ x }}' }), {
      ...opts,
      modules: ['@forinda/kickjs-view'],
    })
    expect(out.match(/declare module/g)).toHaveLength(1)
  })
})

describe('the kick/views typegen', () => {
  function project(files: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), 'kick-typegen-'))
    for (const [p, src] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, p)), { recursive: true })
      writeFileSync(join(dir, p), src)
    }
    return dir
  }

  it('writes .ts, and still gives a broken template an entry, warning once', async () => {
    const cwd = project({ 'src/views/a.kick': '{{ x }}', 'src/views/b.kick': '{{ y | nopipe }}' })
    const warn = vi.fn()
    const tg = viewsTypegen({}, { installed: (pkg) => pkg === '@forinda/kickjs-view' })
    expect(tg.outExtension).toBe('.ts')
    expect(tg.id).toBe('kick/views')
    const out = await tg.generate({
      cwd,
      log: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
    })
    expect(out).toContain("declare module '@forinda/kickjs-view'")
    expect(out).not.toContain("declare module '@forinda/kickjs' {")
    expect(out).toContain('a: {')
    expect(out).toContain('b: {')
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("merges an explicit layout's reads into its pages", async () => {
    const cwd = project({
      'src/views/layouts/main.kick': '<title>{{ title }}</title><slot />',
      'src/views/p.kick': "@layout('layouts/main')\n<p>{{ body }}</p>",
    })
    const out = await viewsTypegen({}, { installed: () => true }).generate({
      cwd,
      log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
    })
    expect(out).toMatch(/\bp: \{\n\s+data: \{ body: unknown; title: unknown \}/)
  })

  it('takes its folders from kickViewsCli options', () => {
    expect(kickViewsCli({ dir: 'views' }).typegens![0]!.inputs).toContain('views/**/*.kick')
  })
})
