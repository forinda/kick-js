import { describe, expect, it } from 'vitest'
import { completions } from '../src/plugin/completion'
import { cursor, uri, workspaceOf } from './helpers'

const FILES = {
  'src/views/page.kick': '',
  'src/views/layouts/main.kick':
    '<head><slot name="head" /><stack name="styles" /></head><slot /><stack name="scripts" />',
  'src/views/layouts/shell.kick': '@fragment(\'shell\') {<nav><slot name="nav" /></nav><slot />}',
  'src/views/components/user-card.kick':
    '@input user\n@input compact = false\n<div>{{ user.name }}</div>',
  'src/views/pipes.ts': 'export const initials = (name: string) => name[0]',
  'src/views/validators.ts': "export const phone = (v: string) => (v ? undefined : 'x')",
}

async function at(marked: string) {
  const ws = await workspaceOf(FILES)
  const { text, offset } = cursor(marked)
  ws.setBuffer(uri('page'), text)
  return completions(ws, uri('page'), text, offset)
}
const labels = async (marked: string) => (await at(marked)).map((i) => i.label)

describe('completions', () => {
  it('@error and the form-state names', async () => {
    const kw = await at('<p>@§')
    expect(kw.find((i) => i.label === 'error')).toMatchObject({
      insertText: "error('${1:field}') {\n\t$0\n}",
    })
    const names = (await at('<p>{{ §')).map((i) => i.label)
    expect(names).toEqual(expect.arrayContaining(['$errors', '$old', '$flash']))
  })
  it('keywords as snippets', async () => {
    const items = await at('<p>@§')
    expect(items.map((i) => i.label)).toEqual(
      expect.arrayContaining(['if', 'for', 'switch', 'let', 'layout', 'slot']),
    )
    expect(items.find((i) => i.label === 'if')).toMatchObject({
      insertText: 'if (${1:condition}) {\n\t$0\n}',
      insertTextFormat: 2,
    })
  })
  it('validators: built-ins and the app, inside validate', async () => {
    expect(await labels('<input name="p" validate="req|§">')).toEqual(
      expect.arrayContaining(['required', 'email', 'phone']),
    )
    expect(await labels('<input name="p" validate="§')).toContain('phone')
    // An argument isn't a validator name.
    expect(await labels('<input name="p" validate="minLength:§')).toEqual([])
  })
  it('pipes: built-ins and the app', async () => {
    expect(await labels('{{ a | §')).toEqual(
      expect.arrayContaining(['uppercase', 'date', 'initials']),
    )
  })
  it('component tags with required inputs', async () => {
    const card = (await at('<us§')).find((i) => i.label === 'user-card')!
    expect(card.insertText).toBe('user-card [user]="$1" />')
  })
  it('component inputs and fallthrough attributes', async () => {
    expect(await labels('<user-card §')).toEqual(
      expect.arrayContaining(['[user]', 'compact', '[compact]', 'class', 'id']),
    )
  })
  it('template names exclude components', async () => {
    const names = await labels("@layout('§")
    expect(names).toEqual(expect.arrayContaining(['layouts/main', 'page']))
    expect(names).not.toContain('components/user-card')
  })
  it("slot names from the page's layout", async () => {
    expect(await labels("@layout('layouts/main')\n@slot('§")).toEqual(['head'])
  })
  it('in-scope names in expressions', async () => {
    expect(await labels('@for (x of xs) { {{ §')).toEqual(expect.arrayContaining(['x', '$index']))
  })
  it('leaves HTML to the HTML service', async () => {
    expect(await at('<p cla§')).toEqual([])
  })

  it('@fragment and @push as snippets', async () => {
    const items = await at('<p>@§')
    expect(items.find((i) => i.label === 'fragment')).toMatchObject({
      insertText: "fragment('${1:name}') {\n\t$0\n}",
    })
    expect(items.find((i) => i.label === 'push')).toMatchObject({
      insertText: "push('${1:stack}') {\n\t$0\n}",
    })
  })

  it("offers the project's stack names after @push('", async () => {
    expect((await labels("@push('§")).toSorted()).toEqual(['scripts', 'styles'])
  })

  it('keeps loop names in scope after a @fragment closes', async () => {
    const names = await labels(
      "@for (u of us; track u) {@fragment('row') {<tr>{{ u }}</tr>}<p>{{ §",
    )
    expect(names).toContain('u')
  })

  it("offers slot names inside a layout's @fragment", async () => {
    expect(await labels("@layout('layouts/shell')\n@slot('§")).toEqual(['nav'])
  })

  it('offers snippet names after @render', async () => {
    expect(await labels('@snippet badge(x) {x}\n@snippet pill() {y}\n@render §')).toEqual(
      expect.arrayContaining(['badge', 'pill']),
    )
  })

  it("offers the values a slot passes after @slot('…'; let", async () => {
    const ws = await workspaceOf({
      ...FILES,
      'src/views/components/x-list.kick': '<ul><slot name="row" [user]="u" [index]="i" /></ul>',
    })
    const { text, offset } = cursor("<x-list>@slot('row'; let §")
    ws.setBuffer(uri('page'), text)
    expect(
      completions(ws, uri('page'), text, offset)
        .map((i) => i.label)
        .toSorted(),
    ).toEqual(['index', 'user'])
  })

  it('offers component tags inside of="…"', async () => {
    expect(await labels('<component [is]="k" of="§')).toContain('user-card')
  })

  it('keeps loop names in scope after a @snippet closes', async () => {
    expect(await labels('@for (u of us; track u) {@snippet s() {x}<p>{{ §')).toContain('u')
  })
})
