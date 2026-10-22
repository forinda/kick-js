/**
 * The built server (`bin/kick-view-ls.js`) over LSP, as an editor drives it.
 * Turbo builds the package before its tests run.
 */
import { join, resolve } from 'node:path'
import {
  LogMessageNotification,
  MessageType,
  PublishDiagnosticsNotification,
} from '@volar/language-server/node.js'
import { startLanguageServer, type LanguageServerHandle } from '@volar/test-utils'
import { URI } from 'vscode-uri'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cursor } from './helpers'

const BIN = resolve(import.meta.dirname, '../bin/kick-view-ls.js')
const APP = resolve(import.meta.dirname, 'fixtures/app')
const EMPTY = resolve(import.meta.dirname, 'fixtures/empty')
const views = (name: string) => URI.file(join(APP, 'src/views', `${name}.kick`)).toString()

async function start(root: string, initializationOptions: object = {}) {
  const server = startLanguageServer(BIN, root)
  const logs: { type: number; message: string }[] = []
  const published = new Map<string, string[]>()
  server.connection.onNotification(LogMessageNotification.type, (m) => void logs.push(m))
  server.connection.onNotification(PublishDiagnosticsNotification.type, (p) =>
    published.set(
      p.uri,
      p.diagnostics.map((d) => d.message),
    ),
  )
  await server.initialize(URI.file(root).toString(), initializationOptions, {
    workspace: { configuration: true },
  })
  return { server, logs, published }
}

describe('language server', () => {
  let server: LanguageServerHandle
  beforeAll(async () => {
    server = (await start(APP)).server
  }, 30_000)
  afterAll(() => server?.shutdown())

  const open = async (name: string, marked: string) => {
    const { text, position } = cursor(marked.includes('§') ? marked : `${marked}§`)
    await server.openInMemoryDocument(views(name), 'kick', text)
    return position
  }

  it('reports a broken template', async () => {
    await open('broken', '<p>{{ user.name | nope }}</p>\n')
    const report = (await server.sendDocumentDiagnosticRequest(views('broken'))) as {
      items: { message: string; source: string }[]
    }
    expect(report.items.map((d) => d.message).join('\n')).toContain('nope')
    expect(report.items[0]!.source).toBe('kick')
  })
  it('completes keywords after @', async () => {
    const at = await open('k1', '<p>@')
    const list = await server.sendCompletionRequest(views('k1'), at)
    expect(list!.items.map((i) => i.label)).toEqual(expect.arrayContaining(['if', 'for']))
  })
  it('completes HTML attributes', async () => {
    const at = await open('k2', '<p cla')
    const list = await server.sendCompletionRequest(views('k2'), at)
    expect(list!.items.map((i) => i.label)).toContain('class')
  })
  it('expands Emmet', async () => {
    const at = await open('k3', '<div>\nul>li*2')
    const list = await server.sendCompletionRequest(views('k3'), at)
    expect(JSON.stringify(list!.items)).toContain('<li>')
  })
  it('completes CSS in <style>', async () => {
    const at = await open('k4', '<style>a{col§}</style>')
    const list = await server.sendCompletionRequest(views('k4'), at)
    expect(list!.items.map((i) => i.label)).toContain('color')
  })
  it("hovers a component's inputs", async () => {
    const at = await open('k5', '<user-c§ard />')
    const hover = await server.sendHoverRequest(views('k5'), at)
    expect(JSON.stringify(hover!.contents)).toContain('required')
  })
  it('goes to a component', async () => {
    const at = await open('k6', '<user-c§ard />')
    // A client without linkSupport gets a Location.
    const [loc] = (await server.sendDefinitionRequest(views('k6'), at)) as { uri: string }[]
    expect(loc!.uri).toBe(views('components/user-card'))
  })
  it('formats', async () => {
    await open('k7', '@if(a){\n<p>x</p>\n}')
    const edits = await server.sendDocumentFormattingRequest(views('k7'), {
      tabSize: 2,
      insertSpaces: true,
    })
    expect(edits!.map((e) => e.newText).join('')).toContain('@if (a) {\n  <p>x</p>\n}')
  })
  it('highlights template syntax with semantic tokens', async () => {
    await open('k8', '<p>{{ user.name | titlecase }}</p>')
    const tokens = await server.sendSemanticTokensRequest(views('k8'))
    // Five numbers per token: `{{`, user, name, |, titlecase, `}}`.
    expect(tokens!.data.length).toBe(6 * 5)
  })
  it('finds references to a component across templates', async () => {
    const at = await open('k9', '<user-ca§rd [user]="x" />')
    const locs = await server.sendReferencesRequest(views('k9'), at, { includeDeclaration: true })
    // Buffers opened by earlier tests use it too.
    expect(locs!.map((l) => l.uri)).toEqual(
      expect.arrayContaining([views('components/user-card'), views('home'), views('k9')]),
    )
  })
  it('renames a pipe across templates and pipes.ts', async () => {
    const at = await open('k10', '{{ n | initi§als }}')
    expect(await server.sendPrepareRenameRequest(views('k10'), at)).toMatchObject({
      start: { line: 0, character: 7 },
    })
    const edit = await server.sendRenameRequest(views('k10'), at, 'firstLetter')
    expect(
      Object.keys(edit!.changes!)
        .map((u) => u.split('/src/views/')[1])
        .toSorted(),
    ).toEqual(['components/user-card.kick', 'k10.kick', 'pipes.ts'])
  })
  it('renames a component: its tags, then its file', async () => {
    const at = await open('k11', '<user-ca§rd [user]="x"></user-card>')
    expect(await server.sendPrepareRenameRequest(views('k11'), at)).toMatchObject({
      start: { line: 0, character: 1 },
      end: { line: 0, character: 10 },
    })
    const edit = await server.sendRenameRequest(views('k11'), at, 'user-badge')
    const moves = edit!.documentChanges!.filter((c) => 'kind' in c)
    expect(moves).toEqual([
      {
        kind: 'rename',
        oldUri: views('components/user-card'),
        newUri: views('components/user-badge'),
      },
    ])
    // The HTML service's tag-pair edit is the same as ours, not added twice.
    const k11 = edit!.documentChanges!.find(
      (c) => !('kind' in c) && c.textDocument.uri === views('k11'),
    ) as { edits: unknown[] }
    expect(k11.edits).toHaveLength(2)
  })
  it('updates uses when a layout file is renamed in the editor', async () => {
    const edit = await server.connection.sendRequest<{ changes?: Record<string, unknown[]> }>(
      'workspace/willRenameFiles',
      { files: [{ oldUri: views('layouts/main'), newUri: views('layouts/site') }] },
    )
    expect(Object.keys(edit!.changes!)).toContain(views('home'))
  })
  it('answers render-call requests for clients that keep TS to themselves', async () => {
    const text = "ctx.render('home')\nctx.render('nope')"
    const link = await server.connection.sendRequest<{ uri: string } | null>(
      'kick/renderDefinition',
      { text, offset: 13 },
    )
    expect(link?.uri).toBe(views('home'))
    const diagnostics = await server.connection.sendRequest<{ message: string }[]>(
      'kick/renderDiagnostics',
      { text },
    )
    expect(diagnostics.map((d) => d.message)).toEqual(["template 'nope' not found"])
  })
  it('lists template names for ctx.render', async () => {
    const names = await server.connection.sendRequest<string[]>('kick/templateNames')
    expect(names).toEqual(expect.arrayContaining(['home', 'layouts/main']))
    expect(names).not.toContain('components/user-card')
  })
})

describe('closing a buffer', () => {
  it('re-checks the open templates that used it', async () => {
    const { server, published } = await start(APP)
    // An unsaved component with a required input, and a page that leaves it out.
    await server.openInMemoryDocument(
      views('components/scratch-card'),
      'kick',
      '@input x\n<p></p>\n',
    )
    await server.openInMemoryDocument(views('scratch-page'), 'kick', '<scratch-card />\n')
    await expect
      .poll(() => published.get(views('scratch-page'))?.join('\n'), { timeout: 10_000 })
      .toContain("missing input 'x'")
    // Closed without saving: the component is gone, so is the error.
    await server.closeTextDocument(views('components/scratch-card'))
    await expect
      .poll(() => published.get(views('scratch-page'))?.join('\n'), { timeout: 10_000 })
      .not.toContain("missing input 'x'")
    await server.shutdown()
  }, 30_000)
})

describe('editors that send another languageId', () => {
  it('still treats .kick files as templates', async () => {
    const { server, published } = await start(APP)
    await server.openInMemoryDocument(views('components/plain-card'), 'html', '@input x\n<p></p>\n')
    await server.openInMemoryDocument(views('plain-page'), 'plaintext', '<plain-card />\n')
    await expect
      .poll(() => published.get(views('plain-page'))?.join('\n'), { timeout: 10_000 })
      .toContain("missing input 'x'")
    await server.shutdown()
  }, 30_000)
})

describe('ctx.render in TypeScript', () => {
  it('completes, links and checks template names', async () => {
    const { server, published } = await start(APP)
    const ts = URI.file(join(APP, 'src/home.controller.ts')).toString()
    const src = "export const show = (ctx) => ctx.render('home', {})\nctx.render('nope')\n"
    await server.openInMemoryDocument(ts, 'typescript', src)
    const list = await server.sendCompletionRequest(ts, { line: 0, character: 43 })
    expect(list!.items.map((i) => i.label)).toEqual(
      expect.arrayContaining(['home', 'layouts/main']),
    )
    expect(list!.items.map((i) => i.label)).not.toContain('components/user-card')
    const [loc] = (await server.sendDefinitionRequest(ts, { line: 0, character: 42 })) as {
      uri: string
    }[]
    expect(loc!.uri).toBe(views('home'))
    await expect
      .poll(() => published.get(ts), { timeout: 10_000 })
      .toEqual(["template 'nope' not found"])
    // TypeScript tooling keeps the rest of the file: no edits, no highlighting.
    const edits = await server.sendDocumentFormattingRequest(ts, { tabSize: 2, insertSpaces: true })
    expect(edits ?? []).toEqual([])
    const tokens = await server.sendSemanticTokensRequest(ts)
    expect(tokens?.data ?? []).toEqual([])
    await server.shutdown()
  }, 30_000)
})

describe('layout settings', () => {
  it("fill a mapped layout's slots", async () => {
    const { server, published } = await start(APP, { layout: { admin: 'layouts/main' } })
    await server.openInMemoryDocument(views('admin/page'), 'kick', "@slot('head') {\n}\n<p></p>\n")
    await expect.poll(() => published.get(views('admin/page')), { timeout: 10_000 }).toEqual([])
    await server.shutdown()
  }, 30_000)
})

describe('idle without templates', () => {
  it('stays quiet', async () => {
    const { server, logs } = await start(EMPTY)
    await server.connection.sendRequest<string[]>('kick/templateNames')
    expect(
      logs.filter((l) => l.type === MessageType.Error || l.type === MessageType.Warning),
    ).toEqual([])
    await server.shutdown()
  }, 30_000)
})
