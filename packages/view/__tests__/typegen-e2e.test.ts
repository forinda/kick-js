/**
 * End to end: the real `kick/views` typegen over a small app, then `tsc` over
 * a controller using `ctx.render` / `views.render` against the generated file
 * and the built packages — the way an app sees them. No stubs.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { viewsTypegen } from '../src/typegen'

const REPO = resolve(import.meta.dirname, '../../..')

function app(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'kick-views-e2e-'))
  for (const [p, src] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true })
    writeFileSync(join(dir, p), src)
  }
  mkdirSync(join(dir, 'node_modules/@forinda'), { recursive: true })
  symlinkSync(join(REPO, 'packages/kickjs'), join(dir, 'node_modules/@forinda/kickjs'))
  symlinkSync(join(REPO, 'packages/view'), join(dir, 'node_modules/@forinda/kickjs-view'))
  return dir
}

/** tsc's diagnostics, or '' only when it exited cleanly. */
function tsc(dir: string): string {
  try {
    execFileSync(join(REPO, 'node_modules/.bin/tsc'), ['-p', dir], { encoding: 'utf8' })
    return ''
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string }
    // A failure is never '' — even one that printed nothing.
    return `${e.stdout ?? ''}${e.stderr ?? ''}`.trim() || e.message
  }
}

describe('typed render, end to end', () => {
  it('types ctx.render and views.render from the generated registry', async () => {
    const dir = app({
      'package.json': '{ "name": "e2e", "type": "module" }',
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          strict: true,
          target: 'es2022',
          module: 'esnext',
          moduleResolution: 'bundler',
          noEmit: true,
          skipLibCheck: true,
          types: [],
        },
        include: ['src', '.kickjs/types'],
      }),
      'src/domain/user.ts':
        'export interface User { name: string }\nexport interface Site { name: string }\n',
      'src/views/users/show.kick':
        "@import type { User } from '../../domain/user'\n@input user: User\n@for (p of posts) {{{ $index }}{{ p.title }}@fragment('row') {<li>{{ p.title }}</li>}}\n@if (me) {{{ me.name }}}\n",
      'src/views/layouts/main.kick':
        "@import type { Site } from '../../domain/user'\n@input site: Site\n<title>{{ site.name }}</title><slot />",
      'src/views/home.kick': "@layout('layouts/main')\n<p>{{ greeting }}</p>",
      'src/views/shared.ts':
        "declare module '@forinda/kickjs' {\n  interface KickViewShared { csrfToken: string }\n}\nexport {}\n",
      'src/controller.ts': `
import type { RequestContext } from '@forinda/kickjs'
import type { Views } from '@forinda/kickjs-view'
import type { User } from './domain/user'

interface ShowData { user: User; posts: { title: string }[]; me: { name: string } | null }

export function calls(ctx: RequestContext, views: Views, d: ShowData) {
  ctx.render('users/show', d)
  ctx.render('users/show', { user: { name: 'a' }, posts: [], me: null, extra: 1 })
  ctx.render('users/show', { p: { title: 'x' } }, { fragment: 'row' })
  ctx.render('home', { greeting: 'hi', site: { name: 's' } })
  views.render('home', { greeting: 'hi', site: { name: 's' } })
  // @ts-expect-error a misspelled template
  ctx.render('users/shwo', d)
  // @ts-expect-error user is missing
  ctx.render('users/show', { posts: [], me: null })
  // @ts-expect-error the layout's site is missing
  ctx.render('home', { greeting: 'hi' })
}
`,
    })
    const out = await viewsTypegen().generate({ cwd: dir, log: { warn: vi.fn() } })
    expect(out, 'the typegen wrote nothing').toBeTruthy()
    mkdirSync(join(dir, '.kickjs/types'), { recursive: true })
    writeFileSync(join(dir, '.kickjs/types/kick__views.ts'), out!)
    expect(tsc(dir)).toBe('')
  }, 60_000)
})
