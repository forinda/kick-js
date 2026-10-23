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

describe('the kvQuery pipe', () => {
  const render = (src: string, data: object = {}) => views(src).render('page', data, { ctx })

  it('is a built-in pipe', () => {
    expect(BUILTIN_PIPES).toContain('kvQuery')
  })

  it('adds key/value pairs to a kvRoute URL, encoded', async () => {
    const html = await render(`{{ 'Users.list' | kvRoute | kvQuery:'page':page:'q':term }}`, {
      page: 2,
      term: 'a b&c',
    })
    expect(html).toBe('/api/v1/Users.list/?page=2&amp;q=a%20b%26c')
  })

  it('skips empty values, repeats arrays', async () => {
    const html = await render(`{{ '/x' | kvQuery:'a':none:'b':'':'tag':tags:'c':0 }}`, {
      none: null,
      tags: ['x', 'y'],
    })
    expect(html).toBe('/x?tag=x&amp;tag=y&amp;c=0')
  })

  it('adds to an existing query and keeps the fragment last', async () => {
    expect(await render(`{{ '/x?a=1#top' | kvQuery:'b':2 }}`)).toBe('/x?a=1&amp;b=2#top')
    expect(await render(`{{ '/x' | kvQuery:'a':none }}`, { none: undefined })).toBe('/x')
  })

  it('an odd number of arguments is an error', async () => {
    await expect(render(`{{ '/x' | kvQuery:'a' }}`)).rejects.toThrow(
      'kvQuery takes key/value pairs',
    )
  })
})

it("the guide's Next link: arithmetic and an optional filter as kvQuery values", async () => {
  const v = views(
    `<a href="{{ 'UsersController.list' | kvRoute | kvQuery:'page':page + 1:'role':filters.role }}">Next</a>`,
  )
  expect(await v.render('page', { page: 2, filters: {} }, { ctx })).toBe(
    '<a href="/api/v1/UsersController.list/?page=3">Next</a>',
  )
})
