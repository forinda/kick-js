import { describe, expect, it } from 'vitest'
import { createKickServicePlugin } from '../src/plugin/index'
import { cursor, doc, uri, workspaceOf } from './helpers'

describe('createKickServicePlugin', () => {
  it('completes from the unsaved buffer', async () => {
    const ws = await workspaceOf({
      'src/views/page.kick': '',
      'src/views/layouts/main.kick': '<slot name="head" /><slot />',
    })
    const service = createKickServicePlugin(ws).create({} as never)
    const { text, position } = cursor("@layout('layouts/main')\n@slot('§")
    const list = await service.provideCompletionItems!(
      doc(uri('page'), text),
      position,
      {} as never,
      {} as never,
    )
    expect(list!.items.map((i) => i.label)).toEqual(['head'])
  })
  it('ignores embedded documents', async () => {
    const ws = await workspaceOf({ 'src/views/page.kick': '' })
    const service = createKickServicePlugin(ws).create({} as never)
    const d = { ...(doc(uri('page'), '<p>@') as object), languageId: 'html' } as never
    expect(
      await service.provideCompletionItems!(d, { line: 0, character: 4 }, {} as never, {} as never),
    ).toBeUndefined()
  })
})

describe('formatting', () => {
  it('formats the root document with the editor tab size', async () => {
    const ws = await workspaceOf({ 'src/views/page.kick': '' })
    const service = createKickServicePlugin(ws).create({} as never)
    const edits = await service.provideDocumentFormattingEdits!(
      doc(uri('page'), '@if(a){\n<p>x</p>\n}'),
      {} as never,
      { tabSize: 4, insertSpaces: true },
      undefined,
      {} as never,
    )
    expect(edits![0]!.newText).toBe('@if (a) {\n    <p>x</p>\n}\n')
  })
})
