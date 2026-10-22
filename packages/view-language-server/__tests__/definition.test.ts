import { describe, expect, it } from 'vitest'
import { definition } from '../src/plugin/definition'
import { cursor, uri, workspaceOf } from './helpers'

const FILES = {
  'src/views/page.kick': '',
  'src/views/layouts/main.kick': '<slot />',
  'src/views/components/user-card.kick': '<div></div>',
  'src/views/pipes.ts': '// pipes\nexport const initials = (name: string) => name[0]',
}

async function at(marked: string) {
  const ws = await workspaceOf(FILES)
  const { text, offset } = cursor(marked)
  ws.setBuffer(uri('page'), text)
  return definition(ws, uri('page'), text, offset)
}

describe('definition', () => {
  it('a component tag goes to its file', async () => {
    expect((await at('<user-c§ard />'))!.targetUri).toBe(uri('components/user-card'))
  })
  it('@layout goes to the layout', async () => {
    expect((await at("@layout('layouts/m§ain')"))!.targetUri).toBe(uri('layouts/main'))
  })
  it('a pipe goes to its line in pipes.ts', async () => {
    const loc = (await at('{{ n | ini§tials }}'))!
    expect(loc.targetUri).toBe('file:///app/src/views/pipes.ts')
    expect(loc.targetRange.start.line).toBe(1)
  })
  it('null on plain text', async () => {
    expect(await at('<p>he§llo</p>')).toBeNull()
  })
})
