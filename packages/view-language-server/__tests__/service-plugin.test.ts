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

describe('semantic tokens', () => {
  const legend = {
    tokenTypes: ['namespace', 'keyword', 'comment', 'operator', 'function', 'variable'],
    tokenModifiers: [],
  }
  const tokens = async (
    text: string,
    range = { start: { line: 0, character: 0 }, end: { line: 99, character: 0 } },
  ) => {
    const ws = await workspaceOf({ 'src/views/page.kick': '' })
    const service = createKickServicePlugin(ws).create({} as never)
    return service.provideDocumentSemanticTokens!(
      doc(uri('page'), text),
      range,
      legend,
      {} as never,
    )
  }
  it('gives lines, columns and legend indexes', async () => {
    expect(await tokens('<p>\n  {{ a }}</p>')).toEqual([
      [1, 2, 2, 3, 0],
      [1, 5, 1, 5, 0],
      [1, 7, 2, 3, 0],
    ])
  })
  it('splits a token over lines into one per line', async () => {
    expect(await tokens('{{-- one\ntwo --}}')).toEqual([
      [0, 0, 8, 2, 0],
      [1, 0, 8, 2, 0],
    ])
  })
  it('keeps to the requested range', async () => {
    const r = { start: { line: 1, character: 0 }, end: { line: 2, character: 0 } }
    expect(await tokens('@if (a) {\n{{ b }}\n}', r)).toEqual([
      [1, 0, 2, 3, 0],
      [1, 3, 1, 5, 0],
      [1, 5, 2, 3, 0],
    ])
  })
})
