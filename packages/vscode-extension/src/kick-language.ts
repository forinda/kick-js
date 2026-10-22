/**
 * `.kick` language support: a client for the bundled view language server,
 * plus template-name completion inside `ctx.render('…')` in TypeScript.
 */
import * as vscode from 'vscode'
import { LanguageClient, TransportKind, type ServerOptions } from 'vscode-languageclient/node'

let client: LanguageClient | undefined

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
      // Untrusted: the server never imports the project's own view package.
      trusted: vscode.workspace.isTrusted,
    },
    synchronize: {
      fileEvents: [
        vscode.workspace.createFileSystemWatcher('**/*.kick'),
        vscode.workspace.createFileSystemWatcher('**/pipes.{ts,js}'),
      ],
    },
  })
  void client.start()
}

export function activateKickLanguage(context: vscode.ExtensionContext): void {
  startClient(context)
  context.subscriptions.push(
    vscode.workspace.onDidGrantWorkspaceTrust(async () => {
      await client?.stop()
      startClient(context)
    }),
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
}

export async function deactivateKickLanguage(): Promise<void> {
  await client?.stop()
  client = undefined
}
