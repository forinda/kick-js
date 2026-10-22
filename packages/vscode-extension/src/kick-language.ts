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
  const ensure = () => {
    if (!client) startClient(context)
  }
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((d) => (d.languageId === 'kick' ? ensure() : undefined)),
    vscode.workspace.onDidGrantWorkspaceTrust(() => restart(context)),
    vscode.workspace.onDidChangeConfiguration((e) =>
      e.affectsConfiguration('kickjs.views') ? restart(context) : undefined,
    ),
  )

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      ['typescript', 'typescriptreact', 'javascript'],
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
