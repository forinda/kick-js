/**
 * The language server: Volar's server with the `.kick` language plugin and
 * the HTML, CSS, Emmet and kick service plugins, over the project's own
 * `@forinda/kickjs-view` when it has one.
 */
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
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
  /**
   * The editor trusts the workspace, so the project's own `@forinda/kickjs-view`
   * may be imported. Otherwise the bundled copy is used. Default `false`.
   */
  trusted?: boolean
}

/** Every `.kick` file under `dir`; none when it doesn't exist. */
export async function listKick(dir: string): Promise<string[]> {
  try {
    // Names, not Dirents: Dirent.parentPath needs Node 20.12.
    const names = await readdir(dir, { recursive: true })
    return names.filter((n) => n.endsWith('.kick')).map((n) => join(dir, n))
  } catch {
    return []
  }
}

/** What the server watches: every template, and the pipes file wherever it's configured. */
export function watchPatterns(root: string, pipesFile: string): string[] {
  const patterns = ['**/*.kick', '**/pipes.{ts,js}']
  if (!/^pipes\.(ts|js)$/.test(basename(pipesFile)))
    patterns.push(relative(root, pipesFile).split(sep).join('/'))
  return patterns
}

export function startServer(): void {
  const connection = createConnection()
  const server = createServer(connection)
  let ws: Workspace | undefined
  let watched: string[] = []

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
    const { view } = await loadViewModule(
      root,
      (m) => hasViews && connection.console.warn(m),
      opts.trusted === true,
    )
    const pipesFile = at(opts.pipesFile ?? join(viewsDir, 'pipes.ts'))
    watched = watchPatterns(root, pipesFile)
    ws = new Workspace({
      root,
      viewsDir,
      componentsDir: opts.componentsDir ?? 'components',
      pipesFile,
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
    void server.fileWatcher.watchFiles(watched)
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

  // Buffers count from the moment they open or change, not when a feature first
  // touches them: a page checked before its new component's buffer synced
  // would keep a stale error.
  server.documents.onDidChangeContent(({ document }) => {
    if (document.languageId === 'kick') ws?.sync(document.uri, document.getText())
  })

  // A closed buffer that was never saved stops counting: re-check what used it.
  server.documents.onDidClose(async ({ document }) => {
    if (!ws) return
    await ws.setBuffer(document.uri, undefined)
    await server.languageFeatures.requestRefresh(false)
  })

  connection.onRequest('kick/templateNames', () => {
    if (!ws) return []
    const dir = `${ws.componentsDir()}/`
    return ws.names().filter((n) => !n.startsWith(dir))
  })

  connection.onShutdown(() => server.shutdown())
}
