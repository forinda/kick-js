import * as vscode from 'vscode'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const client = vi.hoisted(() => ({
  ctor: vi.fn(),
  start: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
  sendRequest: vi.fn(async () => ['home', 'layouts/main']),
}))

vi.mock('vscode-languageclient/node', () => ({
  TransportKind: { ipc: 1 },
  LanguageClient: class {
    constructor(...args: unknown[]) {
      client.ctor(...args)
    }
    start = client.start
    stop = client.stop
    sendRequest = client.sendRequest
  },
}))

const { activateKickLanguage } = await import('../src/kick-language')

const context = {
  subscriptions: [] as unknown[],
  asAbsolutePath: (p: string) => `/ext/${p}`,
} as never

/** The TypeScript completion provider `activateKickLanguage` registered. */
function provider() {
  const call = vi.mocked(vscode.languages.registerCompletionItemProvider).mock.calls.at(-1)!
  return call[1] as {
    provideCompletionItems(doc: unknown, pos: unknown): Promise<{ label: string }[] | undefined>
  }
}

const docWith = (line: string) => ({ lineAt: () => ({ text: line }) })

describe('activateKickLanguage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts a client over the bundled server for kick documents', () => {
    activateKickLanguage(context)
    const [id, , serverOptions, clientOptions] = client.ctor.mock.calls[0]!
    expect(id).toBe('kickjs.views') // so kickjs.views.trace.server applies
    expect(serverOptions.run.module).toBe('/ext/dist/kick-view-server.js')
    expect(serverOptions.run.transport).toBe(1)
    expect(clientOptions.documentSelector).toEqual([{ language: 'kick' }])
    expect(client.start).toHaveBeenCalled()
  })

  it("tells the server whether the workspace is trusted, and restarts when it's granted", async () => {
    vscode.workspace.isTrusted = false
    activateKickLanguage(context)
    expect(client.ctor.mock.calls[0]![3].initializationOptions.trusted).toBe(false)
    const grant = vi
      .mocked(vscode.workspace.onDidGrantWorkspaceTrust)
      .mock.calls.at(-1)![0] as () => Promise<void>
    vscode.workspace.isTrusted = true
    await grant()
    expect(client.stop).toHaveBeenCalled()
    expect(client.ctor.mock.calls[1]![3].initializationOptions.trusted).toBe(true)
  })

  it('completes template names in ctx.render', async () => {
    activateKickLanguage(context)
    const p = provider()
    const at = (line: string) =>
      p.provideCompletionItems(docWith(line), new vscode.Position(0, line.length))
    expect((await at("    return ctx.render('"))!.map((i) => i.label)).toEqual([
      'home',
      'layouts/main',
    ])
    expect((await at('views.render("ho'))!.map((i) => i.label)).toEqual(['home', 'layouts/main'])
    expect(await at("ctx.json('")).toBeUndefined()
    expect(client.sendRequest).toHaveBeenCalledWith('kick/templateNames')
  })
})
