/**
 * The language server: Volar's server with the `.kick` language plugin and
 * the HTML, CSS, Emmet and kick service plugins, over the project's own
 * `@forinda/kickjs-view` when it has one.
 */
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { createConnection, createServer, createSimpleProject } from '@volar/language-server/node.js'
import { create as createCssService } from 'volar-service-css'
import { create as createEmmetService } from 'volar-service-emmet'
import { create as createHtmlService } from 'volar-service-html'
import { URI } from 'vscode-uri'
import { kickLanguagePlugin } from './language-plugin'
import { createKickServicePlugin } from './plugin/index'
import { loadViewModule } from './view-module'
import { Workspace } from './workspace'

/** `initializationOptions`; paths are relative to the workspace folder. */
export interface ServerOptions {
  /** Default `src/views`. */
  viewsDir?: string
  /** Default `components`, inside the views folder. */
  componentsDir?: string
  /** Default `<viewsDir>/pipes.ts`. */
  pipesFile?: string
}

async function listKick(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true })
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.kick'))
      .map((e) => join(e.parentPath, e.name))
  } catch {
    return []
  }
}

export function startServer(): void {
  const connection = createConnection()
  const server = createServer(connection)
  let ws: Workspace | undefined

  connection.listen()

  connection.onInitialize(async (params) => {
    // ponytail: the first workspace folder only; one Workspace per folder if multi-root matters.
    const folder = params.workspaceFolders?.[0]?.uri ?? params.rootUri
    const root = folder ? URI.parse(folder).fsPath : process.cwd()
    const opts = (params.initializationOptions ?? {}) as ServerOptions
    const at = (p: string) => (isAbsolute(p) ? p : resolve(root, p))
    const viewsDir = at(opts.viewsDir ?? 'src/views')
    const hasViews = existsSync(viewsDir)
    // A folder without templates stays quiet, even about the fallback.
    const { view } = await loadViewModule(root, (m) => hasViews && connection.console.warn(m))
    ws = new Workspace({
      root,
      viewsDir,
      componentsDir: opts.componentsDir ?? 'components',
      pipesFile: at(opts.pipesFile ?? join(viewsDir, 'pipes.ts')),
      view,
      read: (p) => readFile(p, 'utf8').catch(() => undefined),
      list: listKick,
    })
    await ws.load()
    return server.initialize(params, createSimpleProject([kickLanguagePlugin]), [
      createHtmlService(),
      createCssService(),
      createEmmetService(),
      createKickServicePlugin(ws),
    ])
  })

  connection.onInitialized(() => {
    server.initialized()
    void server.fileWatcher.watchFiles(['**/*.kick', '**/pipes.{ts,js}'])
  })

  server.fileWatcher.onDidChangeWatchedFiles(async ({ changes }) => {
    if (!ws) return
    for (const c of changes) {
      const path = URI.parse(c.uri).fsPath
      // 3: deleted; 1 / 2: created / changed.
      if (c.type === 3) await ws.fileDeleted(path)
      else await ws.fileChanged(path)
    }
    await server.languageFeatures.requestRefresh(false)
  })

  server.documents.onDidClose(({ document }) => ws?.setBuffer(document.uri, undefined))

  connection.onRequest('kick/templateNames', () => {
    if (!ws) return []
    const dir = `${ws.componentsDir()}/`
    return ws.names().filter((n) => !n.startsWith(dir))
  })

  connection.onShutdown(() => server.shutdown())
}
