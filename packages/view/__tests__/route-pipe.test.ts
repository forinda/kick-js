/** `{{ 'Controller.method' | kvRoute:a:b }}`: the request's urlFor, params in path order. */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { BUILTIN_PIPES } from '../src/pipes/builtins'
import { createViews } from '../src/index'

function views(src: string) {
  const viewsDir = mkdtempSync(join(tmpdir(), 'kick-route-'))
  writeFileSync(join(viewsDir, 'page.kick'), src)
  return createViews({ viewsDir, warn: vi.fn() })
}

/** A request's urlFor, as RequestContext has it. */
const ctx = {
  urlFor: (name: string, params: unknown[]) =>
    `/api/v1/${name}/${(params as Array<string | number>).map(encodeURIComponent).join('/')}`,
}

describe('the kvRoute pipe', () => {
  it('is a built-in pipe', () => {
    expect(BUILTIN_PIPES).toContain('kvRoute')
  })

  it("fills a route's params from its arguments, in order", async () => {
    const v = views(`<a href="{{ 'Posts.show' | kvRoute:user.id:post.slug }}">x</a>`)
    const html = await v.render('page', { user: { id: 7 }, post: { slug: 'a b' } }, { ctx })
    expect(html).toBe('<a href="/api/v1/Posts.show/7/a%20b">x</a>')
  })

  it('a route with no params takes none', async () => {
    const v = views(`{{ 'Users.list' | kvRoute }}`)
    expect(await v.render('page', {}, { ctx })).toBe('/api/v1/Users.list/')
  })

  it('outside a request it says how to link instead', async () => {
    const v = views(`{{ 'Users.list' | kvRoute }}`)
    await expect(v.render('page')).rejects.toThrow('kvRoute needs a request')
  })
})
