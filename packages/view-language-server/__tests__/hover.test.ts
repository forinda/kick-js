import { describe, expect, it } from 'vitest'
import { hover } from '../src/plugin/hover'
import { cursor, uri, workspaceOf } from './helpers'

const FILES = {
  'src/views/page.kick': '',
  'src/views/components/user-card.kick': '@input user\n@input compact = false\n<div></div>',
  'src/views/pipes.ts':
    'export const initials = (name: string) => name[0]\nexport function stars(n: number) { return n }',
}

async function at(marked: string) {
  const ws = await workspaceOf(FILES)
  const { text, offset } = cursor(marked)
  ws.setBuffer(uri('page'), text)
  return hover(ws, uri('page'), text, offset)
}

describe('hover', () => {
  it('a built-in pipe', async () => {
    expect((await at('{{ n | title§case }}'))!.contents).toMatchObject({
      value: expect.stringContaining('titlecase'),
    })
  })
  it("an app pipe's signature", async () => {
    expect(JSON.stringify((await at('{{ n | ini§tials }}'))!.contents)).toContain(
      'initials(name: string)',
    )
    expect(JSON.stringify((await at('{{ n | st§ars }}'))!.contents)).toContain('stars(n: number)')
  })
  it("a component's inputs", async () => {
    const text = JSON.stringify((await at('<user-c§ard />'))!.contents)
    expect(text).toContain('user')
    expect(text).toContain('required')
    expect(text).toContain('compact')
    expect(text).toContain('false')
  })
  it('nothing on plain text', async () => {
    expect(await at('<p>he§llo</p>')).toBeNull()
  })
})
