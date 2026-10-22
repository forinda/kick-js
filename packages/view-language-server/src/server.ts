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
import { renderDefinition, renderDiagnostics } from './plugin/render-calls'
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
  /** `createViews({ layout })`: a page's layout when it declares none; one name, or folder prefix → layout. */
  layout?: string | Record<string, string>
  /** `createViews({ baseLayout })`. */
  baseLayout?: string
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

const SKIP = new Set(['node_modules', 'dist', 'build', 'coverage', 'out'])
const SCRIPT = /\.(?:[cm]?[jt]s|[jt]sx)$/

/** TS / JS files under `root`, for `ctx.render('…')` names: no dependencies, build output, dot folders or `.d.ts`. */
export async function listScripts(root: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string) => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP.has(e.name)) continue
      const p = join(dir, e.name)
      if (e.isDirectory()) await walk(p)
      else if (SCRIPT.test(e.name) && !e.name.endsWith('.d.ts')) out.push(p)
    }
  }
  await walk(root)
  return out
}

/** `fn` over `items` with at most `limit` running at once, results in order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = Array.from({ length: items.length })
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
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
      layout: opts.layout || undefined,
      baseLayout: opts.baseLayout || undefined,
      // Read when a template is renamed: an open buffer's text, else the file's.
      // A bounded number of reads at once: a big project would otherwise run
      // out of file handles, and the failed reads would skip their calls.
      scripts: async () =>
        mapLimit(await listScripts(root), 64, async (p) => {
          const uri = URI.file(p).toString()
          const open = server.documents.get(URI.parse(uri))
          return { uri, text: open?.getText() ?? (await readFile(p, 'utf8').catch(() => '')) }
        }),
    })
    await ws.load()
    // Kick first: where a single answer wins (rename, hover), a component tag
    // is ours, not the HTML service's plain tag.
    return server.initialize(params, createSimpleProject([kickLanguagePlugin]), [
      createKickServicePlugin(ws),
      createHtmlService(),
      createCssService(),
      createEmmetService(),
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
    if (document.uri.endsWith('.kick')) ws?.sync(document.uri, document.getText())
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

  // For clients that keep TS / JS files to themselves (the VS Code extension):
  // the same render-call answers, over requests instead of document features.
  connection.onRequest(
    'kick/renderDefinition',
    ({ text, offset }: { text: string; offset: number }) => {
      const link = ws && renderDefinition(ws, text, offset)
      return link ? { uri: link.targetUri, range: link.originSelectionRange } : null
    },
  )
  connection.onRequest('kick/renderDiagnostics', ({ text }: { text: string }) =>
    ws ? renderDiagnostics(ws, text) : [],
  )

  connection.onShutdown(() => server.shutdown())
}
