import { describe, expect, it } from 'vitest'
import { parse } from '../src/parse/template'
import { summarize } from '../src/check/summary'

const sum = (src: string) => summarize(parse(src, 'page.kick').ast)
const fields = (src: string) => sum(src).fields
const U = { k: 'unknown' }
const req = (shape: object) => ({ shape, optional: false, nullable: false })
const opt = (shape: object) => ({ shape, optional: true, nullable: true })
/** Present (a missing name warns at render), but may be null. */
const nul = (shape: object) => ({ shape, optional: false, nullable: true })
const obj = (props: object) => ({ k: 'object', props })

describe('data summary', () => {
  it('nests paths, required when read unguarded', () => {
    expect(fields('{{ user.address.city }}')).toEqual({
      user: req(obj({ address: req(obj({ city: req(U) })) })),
    })
  })

  it('makes a level with a dynamic segment unknown', () => {
    expect(fields('{{ items[i].x }}').items).toEqual(req(U))
  })

  it('lets ?? and ?. leave a name out; conditions only let it be null', () => {
    expect(fields("{{ name ?? 'x' }}").name).toEqual(opt(U))
    expect(fields('{{ u?.name }}').u).toEqual(opt(obj({ name: req(U) })))
    expect(fields('@if (user) { {{ user.name }} }').user).toEqual(nul(obj({ name: req(U) })))
    expect(fields('{{ a && a.b }}').a).toEqual(nul(obj({ b: req(U) })))
    expect(fields("{{ c ? c.d : 'x' }}").c).toEqual(nul(obj({ d: req(U) })))
  })

  it('stays required and non-null when any read is unguarded, @else included', () => {
    expect(fields('@if (user) { {{ user.name }} }{{ user.name }}').user).toEqual(
      req(obj({ name: req(U) })),
    )
    expect(fields('@if (a) {} @else { {{ a.b }} }').a).toEqual(req(obj({ b: req(U) })))
  })

  it("guards an @else by an @if (!x)'s x", () => {
    expect(fields('@if (!user) {<a>in</a>} @else { {{ user.name }} }').user).toEqual(
      nul(obj({ name: req(U) })),
    )
  })

  it("doesn't make an alias's source non-null on its own", () => {
    expect(fields('@let u = user;\n@if (u) { {{ u.name }} }').user).toEqual(
      nul(obj({ name: req(U) })),
    )
  })

  it('reads loops as lists of the item shape, nullable but present', () => {
    expect(fields('@for (u of users; track u.id) { {{ u.name }} }').users).toEqual(
      nul({ k: 'list', item: obj({ name: req(U) }) }),
    )
    expect(fields('@for ([k, v] of m; track k) { {{ v.x }} }').m).toMatchObject({
      shape: { k: 'pairs', value: obj({ x: req(U) }) },
    })
  })

  it("doesn't take the loop's own $index for data", () => {
    expect(Object.keys(fields('@for (u of users) { {{ $index }}{{ $first }}{{ u.n }} }'))).toEqual([
      'users',
    ])
  })

  it('tracks @let to its source', () => {
    expect(fields('@let t = order.total;\n{{ t.amount }}').order).toEqual(
      // The alias is read (present, maybe null); `t.amount` used plainly needs t itself.
      nul(obj({ total: req(obj({ amount: req(U) })) })),
    )
    expect(Object.keys(fields('@let s = a + b;\n{{ s }}')).toSorted()).toEqual(['a', 'b'])
  })

  it('reads pipe inputs, component bindings, snippets and @render arguments', () => {
    expect(fields('{{ d | date }}').d).toEqual(req(U))
    expect(fields('<x-c [user]="me" />').me).toEqual(req(U))
    expect(
      Object.keys(fields('@snippet s(v) {{{ title }}{{ v }}}\n@render s(arg)')).toSorted(),
    ).toEqual(['arg', 'title'])
  })

  it('leaves out form state', () => {
    expect(fields('{{ $errors.name }}{{ $old.x }}{{ $flash.ok }}')).toEqual({})
  })

  it('records declared inputs and type imports', () => {
    const s = sum(
      "@import type { T } from '@/t'\n@input title: string = 'Home'\n@input user: T\n<p></p>",
    )
    expect(s.declared).toEqual({
      title: { type: 'string', optional: true },
      user: { type: 'T', optional: false },
    })
    expect(s.imports).toEqual(["import type { T } from '@/t'"])
  })

  it('gives each fragment its needs and the page data it reads', () => {
    const s = sum(
      "@for (u of users; track u.id) {@fragment('row') {<tr>{{ u.name }}{{ title }}</tr>}}",
    )
    expect(s.fragments.row).toEqual({
      needs: { u: req(obj({ name: req(U) })) },
      reads: { title: req(U) },
    })
  })

  it('keeps needs with no data origin: pair keys, loop lets, computed @lets', () => {
    const s = sum(
      "@for ([k, post] of posts; let i = $index) {@let total = post.a + post.b;\n@fragment('row') { {{ k }}{{ i }}{{ total }}{{ post.title }} }}",
    )
    expect(Object.keys(s.fragments.row!.needs).toSorted()).toEqual(['i', 'k', 'post', 'total'])
    expect(s.fragments.row!.reads).toEqual({})
  })

  it('reads names bound inside a fragment relative to its needs', () => {
    const s = sum("@for (g of groups) {@fragment('group') {@for (x of g.items) { {{ x.n }} }}}")
    expect(s.fragments.group).toEqual({
      // A null g only empties the loop: g and g.items may be null.
      needs: { g: nul(obj({ items: nul({ k: 'list', item: obj({ n: req(U) }) }) })) },
      reads: {},
    })
  })

  it('marks a loop source inside a fragment nullable', () => {
    const s = sum("@fragment('rows') {@for (u of users) { {{ u.n }} }}")
    expect(s.fragments.rows!.reads.users).toMatchObject({ nullable: true })
  })
})
