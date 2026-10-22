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

async function start(root: string) {
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
  await server.initialize(URI.file(root).toString(), {}, { workspace: { configuration: true } })
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
