import { describe, expect, it } from 'vitest'
import * as view from '@forinda/kickjs-view'
import { Workspace } from '../src/workspace'
import { createDiagnosticsPlugin } from '../src/plugin/diagnostics'

const doc = (uri: string, languageId: string, text: string) =>
  ({ uri, languageId, version: 1, getText: () => text }) as never

describe('diagnostics plugin', () => {
  it('reports the root kick document from its current text, nothing for embedded ones', async () => {
    const ws = new Workspace({
      root: '/app',
      viewsDir: '/app/src/views',
      componentsDir: 'components',
      pipesFile: '/app/src/views/pipes.ts',
      view,
      read: async (p) => (p === '/app/src/views/a.kick' ? '{{ a }}' : undefined),
      list: async () => ['/app/src/views/a.kick'],
    })
    await ws.load()
    const plugin = createDiagnosticsPlugin(ws)
    expect(plugin.capabilities.diagnosticProvider).toEqual({
      interFileDependencies: true,
      workspaceDiagnostics: false,
    })
    const instance = plugin.create({} as never)
    const uri = 'file:///app/src/views/a.kick'
    expect(
      await instance.provideDiagnostics!(doc(uri, 'kick', '{{ a | nope }}'), {} as never),
    ).toMatchObject([{ message: "unknown pipe 'nope'", source: 'kick' }])
    expect(
      await instance.provideDiagnostics!(doc(`${uri}.html`, 'html', 'x'), {} as never),
    ).toBeUndefined()
  })
})
