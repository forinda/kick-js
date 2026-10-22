import * as vscode from 'vscode'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const client = vi.hoisted(() => ({
  ctor: vi.fn(),
  start: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
  sendRequest: vi.fn(async (_method: string, _params?: unknown): Promise<unknown> => [
    'home',
    'layouts/main',
  ]),
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

const { activateKickLanguage, deactivateKickLanguage } = await import('../src/kick-language')

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
  beforeEach(() => {
    vi.clearAllMocks()
    client.start.mockImplementation(async () => {})
    client.sendRequest.mockImplementation(async () => ['home', 'layouts/main'])
    ;(vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = []
    // A workspace with templates, unless a test says otherwise.
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue([{} as vscode.Uri])
  })
  afterEach(() => deactivateKickLanguage())

  it('stays off without templates, and starts when the first .kick file opens', async () => {
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue([])
    await activateKickLanguage(context)
    expect(client.ctor).not.toHaveBeenCalled()
    // No server to restart yet.
    const onChange = vi.mocked(vscode.workspace.onDidChangeConfiguration).mock.calls.at(-1)![0] as (
      e: unknown,
    ) => Promise<void>
    await onChange({ affectsConfiguration: (s: string) => s === 'kickjs.views' })
    expect(client.ctor).not.toHaveBeenCalled()
    const opened = vi.mocked(vscode.workspace.onDidOpenTextDocument).mock.calls.at(-1)![0] as (
      d: unknown,
    ) => void
    opened({ languageId: 'typescript' })
    expect(client.ctor).not.toHaveBeenCalled()
    opened({ languageId: 'kick' })
    opened({ languageId: 'kick' })
    expect(client.ctor).toHaveBeenCalledTimes(1)
  })

  it('starts a client over the bundled server for kick documents', async () => {
    await activateKickLanguage(context)
    const [id, , serverOptions, clientOptions] = client.ctor.mock.calls[0]!
    expect(id).toBe('kickjs.views') // so kickjs.views.trace.server applies
    expect(serverOptions.run.module).toBe('/ext/dist/kick-view-server.js')
    expect(serverOptions.run.transport).toBe(1)
    expect(clientOptions.documentSelector).toEqual([{ language: 'kick' }])
    expect(client.start).toHaveBeenCalled()
  })

  /** A TS document the providers read. */
  const tsDoc = (text: string) => ({
    uri: { toString: () => 'file:///app/src/home.controller.ts' },
    languageId: 'typescript',
    getText: () => text,
    offsetAt: (p: { character: number }) => p.character,
  })

  it('goes to the template from ctx.render in TS, asking the server', async () => {
    client.sendRequest.mockImplementation(async (method: string) =>
      method === 'kick/renderDefinition'
        ? { uri: 'file:///app/src/views/home.kick', range: {} }
        : ([] as never),
    )
    await activateKickLanguage(context)
    const provider = vi.mocked(vscode.languages.registerDefinitionProvider).mock.calls.at(-1)!
    expect(provider[0]).toEqual(expect.arrayContaining(['typescript', 'javascript']))
    const doc = tsDoc("ctx.render('home')")
    const [loc] = (await (provider[1] as { provideDefinition: Function }).provideDefinition(
      doc,
      new vscode.Position(0, 13),
    )) as { uri: { toString(): string } }[]
    expect(client.sendRequest).toHaveBeenCalledWith('kick/renderDefinition', {
      text: "ctx.render('home')",
      offset: 13,
    })
    expect(loc!.uri.toString()).toBe('file:///app/src/views/home.kick')
  })

  it("shows the server's warnings for missing templates in TS files", async () => {
    client.sendRequest.mockImplementation(async (method: string) =>
      method === 'kick/renderDiagnostics'
        ? [
            {
              range: { start: { line: 1, character: 12 }, end: { line: 1, character: 16 } },
              message: "template 'nope' not found",
            },
          ]
        : ([] as never),
    )
    await activateKickLanguage(context)
    const collection = vi.mocked(vscode.languages.createDiagnosticCollection).mock.results.at(-1)!
      .value as { set: ReturnType<typeof vi.fn> }
    const opened = vi.mocked(vscode.workspace.onDidOpenTextDocument).mock.calls.at(-1)![0] as (
      d: unknown,
    ) => Promise<void>
    const doc = tsDoc("ctx.render('home')\nctx.render('nope')")
    ;(vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [doc]
    await opened(doc)
    expect(client.sendRequest).toHaveBeenCalledWith('kick/renderDiagnostics', {
      text: doc.getText(),
    })
    const [, diagnostics] = collection.set.mock.calls.at(-1)! as [
      unknown,
      { message: string; source: string }[],
    ]
    expect(diagnostics.map((d) => [d.message, d.source])).toEqual([
      ["template 'nope' not found", 'kick'],
    ])
  })

  it('drops a check whose file closed, or whose request failed', async () => {
    let answer!: (v: unknown) => void
    client.sendRequest.mockImplementation(
      (method: string) =>
        (method === 'kick/renderDiagnostics'
          ? new Promise((r) => (answer = r))
          : Promise.resolve([])) as never,
    )
    await activateKickLanguage(context)
    const collection = vi.mocked(vscode.languages.createDiagnosticCollection).mock.results.at(-1)!
      .value as { set: ReturnType<typeof vi.fn> }
    const opened = vi.mocked(vscode.workspace.onDidOpenTextDocument).mock.calls.at(-1)![0] as (
      d: unknown,
    ) => Promise<void>
    const doc = tsDoc("ctx.render('nope')")
    ;(vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [doc]
    const checking = opened(doc)
    // Closed while the server was answering.
    ;(vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = []
    answer([
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: 'x' },
    ])
    await checking
    expect(collection.set).not.toHaveBeenCalled()

    client.sendRequest.mockImplementation(async () => {
      throw new Error('Client is not running')
    })
    ;(vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [doc]
    await expect(opened(doc)).resolves.toBeUndefined()
    expect(collection.set).not.toHaveBeenCalled()
  })

  it('passes the layout mapping and base layout settings', async () => {
    const settings: Record<string, unknown> = {
      layout: { admin: 'layouts/admin' },
      baseLayout: 'layouts/base',
    }
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValueOnce({
      get: vi.fn((key: string, fallback: unknown) => settings[key] ?? fallback),
    } as never)
    await activateKickLanguage(context)
    expect(client.ctor.mock.calls[0]![3].initializationOptions).toMatchObject(settings)
  })

  it("tells the server whether the workspace is trusted, and restarts when it's granted", async () => {
    ;(vscode.workspace as { isTrusted: boolean }).isTrusted = false
    await activateKickLanguage(context)
    expect(client.ctor.mock.calls[0]![3].initializationOptions.trusted).toBe(false)
    const grant = vi
      .mocked(vscode.workspace.onDidGrantWorkspaceTrust)
      .mock.calls.at(-1)![0] as () => Promise<void>
    ;(vscode.workspace as { isTrusted: boolean }).isTrusted = true
    await grant()
    expect(client.stop).toHaveBeenCalled()
    expect(client.ctor.mock.calls[1]![3].initializationOptions.trusted).toBe(true)
  })

  it('completes template names in ctx.render', async () => {
    await activateKickLanguage(context)
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

  it('restarts the server when a views setting changes', async () => {
    await activateKickLanguage(context)
    const onChange = vi.mocked(vscode.workspace.onDidChangeConfiguration).mock.calls.at(-1)![0] as (
      e: unknown,
    ) => Promise<void>
    await onChange({ affectsConfiguration: (s: string) => s === 'kickjs.editor' })
    expect(client.stop).not.toHaveBeenCalled()
    await onChange({ affectsConfiguration: (s: string) => s === 'kickjs.views' })
    expect(client.stop).toHaveBeenCalledTimes(1)
    expect(client.ctor).toHaveBeenCalledTimes(2)
  })

  it('waits for startup before restarting on trust grant', async () => {
    let started!: () => void
    client.start.mockImplementationOnce(() => new Promise<void>((r) => (started = r)))
    await activateKickLanguage(context)
    const grant = vi
      .mocked(vscode.workspace.onDidGrantWorkspaceTrust)
      .mock.calls.at(-1)![0] as () => Promise<void>
    const restarted = grant()
    await Promise.resolve()
    expect(client.stop).not.toHaveBeenCalled()
    started()
    await restarted
    expect(client.stop).toHaveBeenCalledTimes(1)
    expect(client.ctor).toHaveBeenCalledTimes(2)
  })
})
