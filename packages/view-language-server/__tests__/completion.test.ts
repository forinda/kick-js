import { describe, expect, it } from 'vitest'
import { completions } from '../src/plugin/completion'
import { cursor, uri, workspaceOf } from './helpers'

const FILES = {
  'src/views/page.kick': '',
  'src/views/layouts/main.kick': '<head><slot name="head" /></head><slot />',
  'src/views/components/user-card.kick':
    '@input user\n@input compact = false\n<div>{{ user.name }}</div>',
  'src/views/pipes.ts': 'export const initials = (name: string) => name[0]',
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
})
