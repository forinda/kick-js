/**
 * `virtual:kick-views` — the app's `.kick` templates, checked at build time
 * and shipped as data, plus its pipes file. A broken template fails the
 * build. Under `serve` the bundle is `null`: the app's file loader reads
 * templates and picks up edits on the next request.
 *
 * @module @forinda/kickjs-vite/kick-views-plugin
 */
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import type { Plugin } from 'vite'

export interface KickViewsPluginOptions {
  /** Default `src/views`. */
  viewsDir?: string
  /** Default `src/views/pipes.ts`. */
  pipesFile?: string
  /** Default `components`, inside the views folder. */
  componentsDir?: string
  /** Where component scripts are served (the views' `clientScriptPath`). Default `'/_kick/c'`. */
  clientScriptPath?: string
}

const ID = 'virtual:kick-views'
const RESOLVED = '\0virtual:kick-views'

async function kickFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return []
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.kick'))
    .map((e) =>
      relative(dir, join(direntDir(e), e.name))
        .slice(0, -'.kick'.length)
        .split(sep)
        .join('/'),
    )
    .toSorted()
}

export function kickViewsPlugin(options: KickViewsPluginOptions = {}): Plugin {
  let viewsDir = ''
  let pipesFile = ''
  let build = true
  let checked: string | undefined
  // Exported by the virtual module, so `createViews({ ...kickViews })` serves where this plugin does.
  const scriptPath = (options.clientScriptPath ?? '/_kick/c').replace(/\/+$/, '')
  let root = ''
  // What the nested browser build takes from the app's config.
  let shared: ClientBuildConfig = {}

  /** Parse and check every template; the bundle as JSON, or a build error listing every problem. */
  async function checkTemplates(ctx: {
    addWatchFile(id: string): void
    warn(message: string): void
    error(message: string): never
  }): Promise<string> {
    const hasPipes = existsSync(pipesFile)
    // The view package is optional: only apps that import this module need it.
    const view = await import('@forinda/kickjs-view')
    const names = await kickFiles(viewsDir)
    const errors: string[] = []
    const pipeNames = [...view.BUILTIN_PIPES]
    if (hasPipes) {
      const read = view.readPipeExports(await readFile(pipesFile, 'utf8'), pipesFile)
      pipeNames.push(...read.names)
      for (const d of read.diagnostics) {
        errors.push(`${d.file}:${d.span.start.line}:${d.span.start.column} — ${d.message}`)
      }
    }
    const templates = new Map()
    for (const name of names) {
      const file = join(viewsDir, `${name}.kick`)
      ctx.addWatchFile(file)
      const parsed = view.parse(await readFile(file, 'utf8'), `${name}.kick`)
      templates.set(name, parsed.ast)
      for (const d of parsed.diagnostics) {
        if (d.severity === 'error')
          errors.push(`${d.file}:${d.span.start.line}:${d.span.start.column} — ${d.message}`)
      }
    }
    const project = {
      templates,
      pipes: new Set(pipeNames),
      componentsDir: options.componentsDir ?? 'components',
    }
    const checked: Record<string, unknown> = {}
    for (const name of names) {
      const r = view.check(name, project)
      for (const d of r.diagnostics) {
        const line = `${d.file}:${d.span.start.line}:${d.span.start.column} — ${d.message}`
        if (d.severity === 'error') errors.push(line)
        else ctx.warn(line)
      }
      if (r.template) checked[name] = r.template
    }
    // Client scripts bundled together: imports resolved, shared code in shared chunks.
    const scripts = Object.entries(checked as Record<string, { client?: { code: string } }>)
      .filter(([, t]) => t.client)
      .map(([name, t]) => ({
        tag: view.componentTag(name, project.componentsDir),
        file: join(viewsDir, `${name}.kick`),
        code: t.client!.code,
      }))
    let client: ClientBundle | undefined
    if (scripts.length) {
      try {
        client = await bundleClientScripts(scripts, root, shared, scriptPath)
      } catch (err) {
        errors.push(`<script client> bundling failed: ${(err as Error).message}`)
      }
    }
    // `<script client>` ships as plain JS: the edge never strips types.
    for (const [name, t] of Object.entries(checked) as Array<
      [string, { client?: { code: string; js: boolean } }]
    >) {
      if (!t.client || t.client.js) continue
      // Bundled: the views serve the bundle's files, not this source.
      if (client) {
        t.client = { code: '', js: true }
        continue
      }
      try {
        t.client = { code: await stripTs(t.client.code, `${name}.ts`), js: true }
      } catch (err) {
        errors.push(`${name}.kick — <script client>: ${(err as Error).message}`)
      }
    }
    if (errors.length)
      ctx.error(`.kick templates have errors:\n  ${[...new Set(errors)].join('\n  ')}`)
    return JSON.stringify({ v: view.AST_FORMAT_VERSION, templates: checked, client }, null, 1)
  }

  return {
    name: 'kickjs:views',
    configResolved(config) {
      viewsDir = resolve(config.root, options.viewsDir ?? 'src/views')
      pipesFile = resolve(config.root, options.pipesFile ?? 'src/views/pipes.ts')
      build = config.command === 'build'
      root = config.root
      shared = {
        mode: config.mode,
        define: config.define,
        envDir: config.envDir,
        envPrefix: config.envPrefix,
        resolve: { alias: config.resolve?.alias ?? [] },
      }
    },
    resolveId(id) {
      if (id === ID) return RESOLVED
      // A component's client script, as a module next to its `.kick` file.
      if (clientModuleFile(id, viewsDir)) return id
      return undefined
    },
    // kick dev: component scripts through Vite's pipeline, so their imports
    // (relative, npm, aliases) resolve as they do in a build. Ahead of the app.
    configureServer(server) {
      const prefix = `${scriptPath}/`
      // An edited template's script is rebuilt on the next request.
      server.watcher.on('change', (file) => {
        const mod = server.moduleGraph.getModuleById(resolve(file) + CLIENT_SUFFIX)
        if (mod) server.moduleGraph.invalidateModule(mod)
      })
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url ?? '').split('?')[0]!
        if ((req.method !== 'GET' && req.method !== 'HEAD') || !url.startsWith(prefix))
          return next()
        const m = /^([a-z][a-z0-9-]*)\.[A-Za-z0-9_-]{8}\.js$/.exec(url.slice(prefix.length))
        if (!m) return next()
        try {
          const view = await import('@forinda/kickjs-view')
          const dir = options.componentsDir ?? 'components'
          const name = (await kickFiles(viewsDir)).find(
            (n) => n.startsWith(`${dir}/`) && view.componentTag(n, dir) === m[1],
          )
          if (!name) return next()
          const file = join(viewsDir, `${name}.kick`)
          if (clientScriptOf(view, await readFile(file, 'utf8')) === undefined) return next()
          const out = await server.transformRequest(file + CLIENT_SUFFIX)
          if (!out) return next()
          res.statusCode = 200
          res.setHeader('content-type', 'text/javascript; charset=utf-8')
          res.setHeader('cache-control', 'no-cache')
          res.end(req.method === 'HEAD' ? undefined : out.code)
        } catch (err) {
          next(err)
        }
      })
    },
    // In a build the templates are checked up front, whether or not the app
    // imports the virtual module: a broken template always fails `kick build`.
    async buildStart() {
      // Apps without templates skip it, so they needn't install the view package.
      if (!build || !(await kickFiles(viewsDir)).length) return
      checked = await checkTemplates(this)
    },
    async load(id) {
      const kickFile = clientModuleFile(id, viewsDir)
      if (kickFile) {
        const view = await import('@forinda/kickjs-view')
        return clientScriptOf(view, await readFile(kickFile, 'utf8'))
      }
      // Any other `.kick.client.ts`: not ours to load.
      if (id.endsWith(`.kick${CLIENT_SUFFIX}`)) return undefined
      if (id !== RESOLVED) return undefined
      const hasPipes = existsSync(pipesFile)
      const pipes = hasPipes
        ? `import * as pipes from ${JSON.stringify(pipesFile)}`
        : 'const pipes = {}'
      let bundle = 'null'
      if (build) {
        checked ??= await checkTemplates(this)
        bundle = checked
      }
      return [
        pipes,
        `const bundle = ${bundle};`,
        `const clientScriptPath = ${JSON.stringify(scriptPath)};`,
        'export { bundle, pipes, clientScriptPath }',
        'export default { bundle, pipes, clientScriptPath }',
      ].join('\n')
    },
  }
}

/**
 * The `.kick` file behind a client-script module id — only inside the views
 * folder, so a crafted dev request can't load a template from elsewhere.
 */
function clientModuleFile(id: string, viewsDir: string): string | undefined {
  if (!viewsDir || !id.endsWith(`.kick${CLIENT_SUFFIX}`)) return undefined
  const file = resolve(id.slice(0, -CLIENT_SUFFIX.length))
  if (!file.startsWith(viewsDir + sep) || !existsSync(file)) return undefined
  return file
}

/** A template's top-level `<script client>` text, as the checker lifts it. */
function clientScriptOf(
  view: { parse(src: string, file: string): { ast: { body: unknown[] } } },
  src: string,
): string | undefined {
  for (const n of view.parse(src, 'x.kick').ast.body as Array<{
    k: string
    tag?: string
    attrs?: Array<{ name: string; kind: string }>
    children?: Array<{ k: string; value?: string }>
  }>) {
    if (
      n.k === 'element' &&
      n.tag?.toLowerCase() === 'script' &&
      n.attrs?.some((a) => a.name.toLowerCase() === 'client' && a.kind === 'bare')
    )
      return (n.children ?? []).map((c) => (c.k === 'text' ? c.value : '')).join('')
  }
  return undefined
}

/** The app config the client build shares: mode, `define`, env files, aliases. */
type ClientBuildConfig = {
  mode?: string
  define?: Record<string, unknown>
  envDir?: string | false
  envPrefix?: string | string[]
  resolve?: { alias: unknown }
}

/** The module id a component's client script builds from: next to its `.kick` file, so `./x` imports resolve there. */
const CLIENT_SUFFIX = '.client.ts'

/**
 * One browser build of every component's `<script client>`: imports
 * (relative, npm, the app's aliases) resolved, code shared by several
 * components in shared chunks. Entries are named by component tag.
 */
async function bundleClientScripts(
  scripts: Array<{ tag: string; file: string; code: string }>,
  root: string,
  shared: ClientBuildConfig,
  scriptPath: string,
): Promise<ClientBundle> {
  const vite = await import('vite')
  const byId = new Map(scripts.map((s) => [s.file + CLIENT_SUFFIX, s.code]))
  const out = (await vite.build({
    ...(shared as object),
    configFile: false,
    root,
    // CSS `url()`s and asset URLs point where the views serve files.
    base: `${scriptPath}/`,
    logLevel: 'silent',
    plugins: [
      {
        name: 'kickjs:client-scripts',
        resolveId: (id: string) => (byId.has(id) ? id : undefined),
        load: (id: string) => byId.get(id),
      },
    ],
    build: {
      write: false,
      minify: true,
      modulePreload: false,
      copyPublicDir: false,
      assetsDir: '',
      // ponytail: images and fonts inline as data URIs, so every served file is text; serve binaries if size bites.
      assetsInlineLimit: () => true,
      rollupOptions: {
        input: Object.fromEntries(scripts.map((s) => [s.tag, s.file + CLIENT_SUFFIX])),
        output: {
          format: 'es',
          entryFileNames: '[name].[hash].js',
          chunkFileNames: (c: { name: string }) => `${servable(c.name)}.[hash].js`,
          assetFileNames: (a: { names?: string[]; name?: string }) =>
            `${servable((a.names?.[0] ?? a.name ?? 'asset').replace(/\.[^.]*$/, ''))}.[hash][extname]`,
        },
      },
    },
  })) as { output: OutputFile[] } | Array<{ output: OutputFile[] }>
  const output = (Array.isArray(out) ? out[0]! : out).output
  const entries: Record<string, string> = {}
  const css: Record<string, string[]> = {}
  const files: Record<string, string> = {}
  const byName = new Map(output.map((f) => [f.fileName, f]))
  /** The stylesheets a chunk and the chunks it imports bring in. */
  const cssOf = (name: string, seen = new Set<string>()): string[] => {
    const c = byName.get(name)
    if (!c || seen.has(name)) return []
    seen.add(name)
    return [
      ...(c.imports ?? []).flatMap((i) => cssOf(i, seen)),
      ...(c.viteMetadata?.importedCss ?? []),
    ]
  }
  for (const f of output) {
    if (f.type === 'chunk') {
      files[f.fileName] = f.code!
      if (f.isEntry && f.name) entries[f.name] = f.fileName
    } else if (f.fileName.endsWith('.css')) {
      files[f.fileName] =
        typeof f.source === 'string' ? f.source : new TextDecoder().decode(f.source)
    } else
      throw new Error(`client scripts can't import ${f.fileName} yet: only CSS and inlined assets`)
  }
  for (const [tag, file] of Object.entries(entries)) {
    const list = [...new Set(cssOf(file))]
    if (list.length) css[tag] = list
  }
  return { entries, css, files }
}

/** Served names allow no dots: `date.utils` becomes `date_utils`. */
const servable = (name: string) => name.replace(/[^A-Za-z0-9_-]/g, '_')

type OutputFile = {
  type: string
  fileName: string
  code?: string
  source?: string | Uint8Array
  isEntry?: boolean
  name?: string
  imports?: string[]
  viteMetadata?: { importedCss?: Set<string> }
}

type ClientBundle = {
  entries: Record<string, string>
  css: Record<string, string[]>
  files: Record<string, string>
}

/**
 * TypeScript to JS with the running Vite: `transformWithOxc` from Vite 8,
 * `transformWithEsbuild` before it (the plugin supports Vite 6 and up).
 */
async function stripTs(code: string, file: string): Promise<string> {
  const vite = (await import('vite')) as typeof import('vite') & {
    transformWithOxc?: typeof import('vite').transformWithOxc
  }
  if ('transformWithOxc' in vite && vite.transformWithOxc)
    return (await vite.transformWithOxc(code, file, { lang: 'ts' })).code
  return (await vite.transformWithEsbuild(code, file, { loader: 'ts' })).code
}

/** A dirent's folder: `parentPath` from Node 20.12, `path` before it. */
function direntDir(e: { parentPath?: string; path?: string }): string {
  return e.parentPath ?? e.path ?? ''
}
