import { describe, expect, it } from 'vitest'
import { parse } from '../src/parse/template'
import { check } from '../src/check/check'
import type { Project } from '../src/check/project'
import { BUILTIN_PIPES } from '../src/pipes/builtins'

function run(files: Record<string, string>, name = 'page') {
  const project: Project = {
    templates: new Map(Object.entries(files).map(([n, s]) => [n, parse(s, `${n}.kick`).ast])),
    pipes: new Set(BUILTIN_PIPES),
    componentsDir: 'components',
  }
  return check(name, project)
}
const sum = (src: string, files: Record<string, string> = {}) => run({ ...files, page: src }).data!
const fields = (src: string, files: Record<string, string> = {}) => sum(src, files).fields
const U = { k: 'unknown' }
const req = (shape: object) => ({ shape, optional: false, nullable: false })
const opt = (shape: object) => ({ shape, optional: true, nullable: true })

describe('data summary', () => {
  it('nests paths, required when read unguarded', () => {
    expect(fields('{{ user.address.city }}')).toEqual({
      user: req({ k: 'object', props: { address: req({ k: 'object', props: { city: req(U) } }) } }),
    })
  })

  it('makes a level with a dynamic segment unknown', () => {
    expect(fields('{{ items[i].x }}').items).toEqual(req(U))
  })

  it('treats ??, conditions and the guarded branch as optional and nullable', () => {
    expect(fields("{{ name ?? 'x' }}").name).toEqual(opt(U))
    expect(fields('@if (user) { {{ user.name }} }').user).toEqual(
      opt({ k: 'object', props: { name: req(U) } }),
    )
    expect(fields('{{ a && a.b }}').a).toMatchObject({ optional: true })
    expect(fields("{{ c ? c.d : 'x' }}").c).toMatchObject({ optional: true })
  })

  it('stays required when any read is unguarded, @else included', () => {
    expect(fields('@if (user) { {{ user.name }} }{{ user.name }}').user).toMatchObject({
      optional: false,
      nullable: false,
    })
    expect(fields('@if (a) {} @else { {{ a.b }} }').a).toMatchObject({ optional: false })
  })

  it('makes the level before ?. optional and nullable', () => {
    expect(fields('{{ u?.name }}').u).toEqual(opt({ k: 'object', props: { name: req(U) } }))
  })

  it('reads loops as lists of the item shape, nullable but required', () => {
    expect(fields('@for (u of users; track u.id) { {{ u.name }} }').users).toEqual({
      // `track` is accepted and ignored by the parser, so `u.id` there isn't a read.
      shape: { k: 'list', item: { k: 'object', props: { name: req(U) } } },
      optional: false,
      nullable: true,
    })
    expect(fields('@for ([k, v] of m; track k) { {{ v.x }} }').m).toMatchObject({
      shape: { k: 'pairs', value: { k: 'object', props: { x: req(U) } } },
    })
  })

  it('tracks @let and @if aliases to their source', () => {
    expect(fields('@let t = order.total;\n{{ t.amount }}').order).toEqual(
      req({ k: 'object', props: { total: req({ k: 'object', props: { amount: req(U) } }) } }),
    )
    const f = fields('@let s = a + b;\n{{ s }}')
    expect(Object.keys(f).toSorted()).toEqual(['a', 'b'])
  })

  it('reads pipe inputs and arguments, component bindings, snippets and @render arguments', () => {
    expect(fields('{{ d | date }}').d).toEqual(req(U))
    expect(fields('<x-c [user]="me" />', { 'components/x-c': '@input user\n<b></b>' }).me).toEqual(
      req(U),
    )
    const f = fields('@snippet s(v) {{{ title }}{{ v }}}\n@render s(arg)')
    expect(Object.keys(f).toSorted()).toEqual(['arg', 'title'])
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

  it('gives each fragment its needs and its own reads', () => {
    const s = sum(
      "@for (u of users; track u.id) {@fragment('row') {<tr>{{ u.name }}{{ title }}</tr>}}",
    )
    expect(s.fragments.row).toEqual({
      u: req({ k: 'object', props: { name: req(U) } }),
      title: req(U),
    })
  })

  it('has no summary for a component', () => {
    expect(run({ 'components/x-c': '<b>{{ 1 }}</b>' }, 'components/x-c').data).toBeUndefined()
  })
})
