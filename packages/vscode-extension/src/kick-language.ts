/**
 * `.kick` language support: a client for the bundled view language server,
 * plus template-name completion inside `ctx.render('…')` in TypeScript.
 */
import * as vscode from 'vscode'
import { LanguageClient, TransportKind, type ServerOptions } from 'vscode-languageclient/node'

let client: LanguageClient | undefined
/** The current client's `start()`: a client can't be stopped while it's starting. */
let starting: Promise<void> = Promise.resolve()
/** Restarts run one after another. */
let restarting: Promise<void> = Promise.resolve()

/** `ctx.render('` / `views.render("` up to the cursor. */
const RENDER = /\b(?:ctx|views)\.render\(\s*['"`][^'"`]*$/
const SCRIPTS = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact']

interface LspRange {
  start: { line: number; character: number }
  end: { line: number; character: number }
}
const toRange = (r: LspRange) =>
  new vscode.Range(
    new vscode.Position(r.start.line, r.start.character),
    new vscode.Position(r.end.line, r.end.character),
  )

function startClient(context: vscode.ExtensionContext): void {
  const module = context.asAbsolutePath('dist/kick-view-server.js')
  const serverOptions: ServerOptions = {
    run: { module, transport: TransportKind.ipc },
    debug: {
      module,
      transport: TransportKind.ipc,
      options: { execArgv: ['--nolazy', '--inspect=6010'] },
    },
  }
  const config = vscode.workspace.getConfiguration('kickjs.views')
  client = new LanguageClient('kickjs.views', 'KickJS Views', serverOptions, {
    documentSelector: [{ language: 'kick' }],
    initializationOptions: {
      viewsDir: config.get<string>('dir', 'src/views'),
      componentsDir: config.get<string>('components', 'components'),
      pipesFile: config.get<string>('pipes') || undefined,
      layout: config.get<string | Record<string, string>>('layout') || undefined,
      baseLayout: config.get<string>('baseLayout') || undefined,
      // Untrusted: the server never imports the project's own view package.
      trusted: vscode.workspace.isTrusted,
    },
    // The server registers its own file watchers, including the configured pipes file.
  })
  starting = client.start().catch(() => {})
}

/** Stop the running server once it has started, then start one with the current settings and trust. */
function restart(context: vscode.ExtensionContext): Promise<void> {
  restarting = restarting.then(async () => {
    // Not started yet: the first .kick file starts it with whatever is current then.
    if (!client) return
    await starting
    await client?.stop().catch(() => {})
    startClient(context)
  })
  return restarting
}

/**
 * The server starts with the first `.kick` file: one in the workspace at
 * activation, or the first one opened later. A KickJS app without views
 * never runs it.
 */
export async function activateKickLanguage(context: vscode.ExtensionContext): Promise<void> {
  const diagnostics = vscode.languages.createDiagnosticCollection('kick')
  /**
   * `ctx.render('…')` names checked by the server. TS / JS files stay out of
   * the client's document selector — that would make the server a TypeScript
   * formatter — so they go over a request instead.
   */
  const isOpen = (doc: vscode.TextDocument) =>
    vscode.workspace.textDocuments.some((d) => d.uri.toString() === doc.uri.toString())
  const checkScript = async (doc: vscode.TextDocument) => {
    if (!client || !SCRIPTS.includes(doc.languageId) || !isOpen(doc)) return
    const text = doc.getText()
    if (!text.includes('.render(')) return diagnostics.delete(doc.uri)
    let found: Array<{ range: LspRange; message: string }>
    try {
      found = await client.sendRequest('kick/renderDiagnostics', { text })
    } catch {
      // Starting, restarting or stopped: the next check catches up.
      return
    }
    // Closed while the server answered: nothing to show it on.
    if (!isOpen(doc)) return
    diagnostics.set(
      doc.uri,
      found.map((d) => {
        const diag = new vscode.Diagnostic(
          toRange(d.range),
          d.message,
          vscode.DiagnosticSeverity.Warning,
        )
        diag.source = 'kick'
        return diag
      }),
    )
  }
  const checkOpenScripts = () => {
    for (const d of vscode.workspace.textDocuments) void checkScript(d)
  }
  const ensure = () => {
    if (client) return
    startClient(context)
    void starting.then(checkOpenScripts)
  }
  const pending = new Map<string, ReturnType<typeof setTimeout>>()
  context.subscriptions.push(
    diagnostics,
    vscode.workspace.onDidOpenTextDocument((d) =>
      d.languageId === 'kick' ? ensure() : checkScript(d),
    ),
    vscode.workspace.onDidChangeTextDocument(({ document: d }) => {
      if (!SCRIPTS.includes(d.languageId)) return
      const key = d.uri.toString()
      clearTimeout(pending.get(key))
      pending.set(
        key,
        setTimeout(() => void checkScript(d), 300),
      )
    }),
    vscode.workspace.onDidCloseTextDocument((d) => {
      clearTimeout(pending.get(d.uri.toString()))
      pending.delete(d.uri.toString())
      diagnostics.delete(d.uri)
    }),
    // A template saved, created or deleted can change what the names point at.
    vscode.workspace.onDidSaveTextDocument((d) =>
      d.languageId === 'kick' ? checkOpenScripts() : undefined,
    ),
    vscode.languages.registerDefinitionProvider(SCRIPTS, {
      async provideDefinition(document, position) {
        if (!client) return undefined
        const found = await client
          .sendRequest<{ uri: string; range: LspRange } | null>('kick/renderDefinition', {
            text: document.getText(),
            offset: document.offsetAt(position),
          })
          .catch(() => null)
        if (!found) return undefined
        const top = new vscode.Position(0, 0)
        return [new vscode.Location(vscode.Uri.parse(found.uri), new vscode.Range(top, top))]
      },
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => restart(context)),
    vscode.workspace.onDidChangeConfiguration((e) =>
      e.affectsConfiguration('kickjs.views') ? restart(context) : undefined,
    ),
  )

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      SCRIPTS,
      {
        async provideCompletionItems(document, position) {
          const line = document.lineAt(position.line).text.slice(0, position.character)
          if (!RENDER.test(line) || !client) return undefined
          const names = await client.sendRequest<string[]>('kick/templateNames')
          return names.map((n) => new vscode.CompletionItem(n, vscode.CompletionItemKind.File))
        },
      },
      "'",
      '"',
      '`',
    ),
  )

  if (vscode.workspace.textDocuments.some((d) => d.languageId === 'kick')) return ensure()
  const found = await vscode.workspace.findFiles('**/*.kick', '**/node_modules/**', 1)
  if (found.length) ensure()
}

export async function deactivateKickLanguage(): Promise<void> {
  await restarting
  await starting
  await client?.stop()
  client = undefined
}
