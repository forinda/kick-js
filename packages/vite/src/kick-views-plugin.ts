/**
 * `virtual:kick-views` — the app's `.kick` templates, checked at build time
 * and shipped as data, plus its pipes file. A broken template fails the
 * build. Under `serve` the bundle is `null`: the app's file loader reads
 * templates and picks up edits on the next request.
 *
 * @module @forinda/kickjs-vite/kick-views-plugin
 */
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, posix, relative, resolve, sep } from 'node:path'
import type { Plugin } from 'vite'

export interface KickViewsPluginOptions {
  /** Default `src/views`. */
  viewsDir?: string
  /** Default `src/views/pipes.ts`. */
  pipesFile?: string
  /** The app's browser validators. Default `<viewsDir>/validators.ts`. */
  validatorsFile?: string
  /** Default `components`, inside the views folder. */
  componentsDir?: string
  /** Where component scripts are served (the views' `clientScriptPath`). Default `'/_kick/c'`. */
  clientScriptPath?: string
  /**
   * Where `kick build` puts client files: `'disk'` (default) writes them to
   * `<outDir>/<publicDir><clientScriptPath>/`, served from disk on Node and by
   * the platform's static files on the edge; `'bundle'` keeps them in the
   * server bundle, for hosts with no static files.
   */
  clientFiles?: 'disk' | 'bundle'
  /** Default `'public'`, relative to the build's `outDir` (or absolute). */
  publicDir?: string
  /** Images and fonts up to this many bytes are inlined (`'disk'` mode). Default `4096`. */
  inlineLimit?: number
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
  let validatorsFile = ''
  /** The module that registers validators.ts's exports: a namespace import keeps every one. */
  const validatorsEntry = () => join(dirname(validatorsFile), VALIDATORS_TAG)
  /** Compared resolved: Vite normalises ids (forward slashes on Windows) before `load`. */
  const isValidatorsEntry = (id: string) =>
    !!validatorsFile && resolve(id) === resolve(validatorsEntry() + CLIENT_SUFFIX)
  let build = true
  let checked: string | undefined
  // Exported by the virtual module, so `createViews({ ...kickViews })` serves where this plugin does.
  const scriptPath = (options.clientScriptPath ?? '/_kick/c').replace(/\/+$/, '')
  const onDisk = options.clientFiles !== 'bundle'
  /** Client files to write beside the server bundle, by path inside its `outDir`. */
  let clientOut: Map<string, string | Uint8Array> | undefined
  /** The client files the last build wrote, by absolute path. */
  let written = new Set<string>()
  const clientFolder = posix.join(options.publicDir ?? 'public', scriptPath.slice(1))
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
    // Empty, a rebuild with no client scripts left still clears the last build's files.
    clientOut = onDisk ? new Map() : undefined
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
    const validators = new Set<string>()
    const hasValidators = existsSync(validatorsFile)
    // Watched before it exists too: a `vite build --watch` picks up a new one.
    ctx.addWatchFile(validatorsFile)
    if (hasValidators) {
      if (!('readValidatorExports' in view))
        errors.push('custom validators need a newer @forinda/kickjs-view: upgrade it')
      else {
        const read = view.readValidatorExports(
          await readFile(validatorsFile, 'utf8'),
          validatorsFile,
        )
        for (const n of read.names) validators.add(n)
        for (const d of read.diagnostics)
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
      validators,
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
    // validators.ts: one more entry, so it's bundled even with no component scripts.
    if (hasValidators)
      scripts.push({
        tag: VALIDATORS_TAG,
        file: validatorsEntry(),
        code: validatorsWrapper(validatorsFile),
      })
    let client: ClientBundle | undefined
    if (scripts.length && onDisk && !('useClientFiles' in view))
      errors.push(
        "client files on disk need @forinda/kickjs-view 0.3 or later: upgrade it, or set views: { clientFiles: 'bundle' }",
      )
    else if (scripts.length) {
      try {
        client = await bundleClientScripts(
          scripts,
          root,
          shared,
          scriptPath,
          onDisk ? (options.inlineLimit ?? 4096) : () => true,
          (file) => ctx.addWatchFile(file),
        )
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
    let out: Record<string, unknown> | undefined
    if (client && onDisk) {
      // Vite drops assets from server builds: written in `writeBundle` instead.
      clientOut = new Map(
        Object.entries(client.files).map(([name, source]) => [
          posix.join(clientFolder, name),
          source,
        ]),
      )
      out = { entries: client.entries, css: client.css, disk: Object.keys(client.files) }
    } else if (client) {
      for (const [name, source] of Object.entries(client.files))
        if (typeof source !== 'string')
          ctx.error(`client file ${name} isn't text: use clientFiles: 'disk' to serve it`)
      out = client
    }
    return JSON.stringify({ v: view.AST_FORMAT_VERSION, templates: checked, client: out }, null, 1)
  }

  return {
    name: 'kickjs:views',
    configResolved(config) {
      viewsDir = resolve(config.root, options.viewsDir ?? 'src/views')
      pipesFile = resolve(config.root, options.pipesFile ?? 'src/views/pipes.ts')
      // Beside the views, as the editor and `kick check:views` look for it.
      validatorsFile = options.validatorsFile
        ? resolve(config.root, options.validatorsFile)
        : join(viewsDir, 'validators.ts')
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
      if (isValidatorsEntry(id)) return id
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
        if (m[1] === VALIDATORS_TAG) {
          if (!existsSync(validatorsFile)) return next()
          try {
            const out = await server.transformRequest(validatorsEntry() + CLIENT_SUFFIX)
            if (!out) return next()
            res.statusCode = 200
            res.setHeader('content-type', 'text/javascript; charset=utf-8')
            res.setHeader('cache-control', 'no-cache')
            res.end(req.method === 'HEAD' ? undefined : out.code)
          } catch (err) {
            next(err)
          }
          return
        }
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
      if (!build || !(await kickFiles(viewsDir)).length) {
        // The last template removed between rebuilds: nothing of the last build is current.
        checked = undefined
        if (clientOut) clientOut = new Map()
        return
      }
      checked = await checkTemplates(this)
    },
    renderChunk(code, chunk, out) {
      if (!code.includes(CLIENT_DIR)) return null
      const dir = out.dir ?? (out.file ? dirname(out.file) : '')
      const rel = relative(resolve(dir, dirname(chunk.fileName)), resolve(dir, clientFolder))
      return {
        code: code.replaceAll(CLIENT_DIR, `./${rel.split(sep).join('/')}/`),
        map: null,
      }
    },
    async writeBundle(out) {
      if (!clientOut || !out.dir) return
      // A rebuild (`vite build --watch`) doesn't empty outDir: drop the files the
      // last build wrote that this one doesn't. Only ours: nothing else is touched.
      const keep = new Set([...clientOut.keys()].map((f) => resolve(out.dir!, f)))
      for (const file of written) if (!keep.has(file)) await rm(file, { force: true })
      written = keep
      for (const [file, source] of clientOut) {
        const to = resolve(out.dir, file)
        await mkdir(dirname(to), { recursive: true })
        await writeFile(to, source)
      }
    },
    async load(id) {
      const kickFile = clientModuleFile(id, viewsDir)
      if (kickFile) {
        const view = await import('@forinda/kickjs-view')
        return clientScriptOf(view, await readFile(kickFile, 'utf8'))
      }
      if (isValidatorsEntry(id)) return validatorsWrapper(validatorsFile)
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
        // The folder beside this bundle; the edge may have no usable `import.meta.url`.
        // The folder beside this bundle (`renderChunk` fills the path); the
        // edge may have no usable `import.meta.url`.
        clientOut
          ? `const clientDir = (() => { try { return new URL(${JSON.stringify(CLIENT_DIR)}, import.meta.url).href } catch { return undefined } })();`
          : 'const clientDir = undefined;',
        // kick dev: the views read the validators file this plugin serves, wherever it's configured.
        `export const validatorsFile = ${build ? 'undefined' : JSON.stringify(validatorsFile)};`,
        'export { bundle, pipes, clientScriptPath, clientDir }',
        `export default { bundle, pipes, clientScriptPath, clientDir${build ? '' : ', validatorsFile'} }`,
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

/** Replaced, per output chunk, with the relative path to the client files folder. */
const CLIENT_DIR = '__KICK_CLIENT_DIR__'

/** The module id a component's client script builds from: next to its `.kick` file, so `./x` imports resolve there. */
const CLIENT_SUFFIX = '.client.ts'

/** The view package's tag for the app's validators script: `kick-validators.<hash>.js`. */
const VALIDATORS_TAG = 'kick-validators'

/**
 * Registers every validators.ts export for the validator script. A namespace
 * import, not the module itself as the entry: app builds drop entry exports.
 */
function validatorsWrapper(file: string): string {
  return `import * as v from ${JSON.stringify(file)}\nObject.assign((globalThis.__kickValidators ??= {}), v)\n`
}

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
  inline: number | (() => boolean),
  /** Each of the app's files the scripts import, so a watch build sees their edits. */
  watch: (file: string) => void,
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
      assetsInlineLimit: inline,
      rollupOptions: {
        input: Object.fromEntries(scripts.map((s) => [s.tag, s.file + CLIENT_SUFFIX])),
        output: {
          format: 'es',
          entryFileNames: '[name].[hash].js',
          chunkFileNames: (c: { name: string }) => `${servable(c.name)}.[hash].js`,
          // Served names take a lower-case extension: `Logo.PNG` becomes `Logo.<hash>.png`.
          assetFileNames: (a: { names?: string[]; name?: string }) => {
            const name = a.names?.[0] ?? a.name ?? 'asset'
            const ext = /\.[^.]*$/.exec(name)?.[0] ?? ''
            return `${servable(name.slice(0, name.length - ext.length))}.[hash]${ext.toLowerCase()}`
          },
        },
      },
    },
  })) as { output: OutputFile[] } | Array<{ output: OutputFile[] }>
  const output = (Array.isArray(out) ? out[0]! : out).output
  const entries: Record<string, string> = {}
  const css: Record<string, string[]> = {}
  const files: Record<string, string | Uint8Array> = {}
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
      for (const id of f.moduleIds ?? [])
        if (!id.startsWith('\0') && !id.endsWith(CLIENT_SUFFIX) && !id.includes('/node_modules/'))
          watch(id)
      files[f.fileName] = f.code!
      if (f.isEntry && f.name) entries[f.name] = f.fileName
    } else if (f.fileName.endsWith('.css')) {
      files[f.fileName] =
        typeof f.source === 'string' ? f.source : new TextDecoder().decode(f.source)
    } else files[f.fileName] = f.source!
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
  moduleIds?: string[]
  viteMetadata?: { importedCss?: Set<string> }
}

type ClientBundle = {
  entries: Record<string, string>
  css: Record<string, string[]>
  files: Record<string, string | Uint8Array>
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
