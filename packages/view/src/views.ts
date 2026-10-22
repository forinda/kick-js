/**
 * `createViews`: templates from a loader or a build's bundle, checked once
 * and cached, rendered with the app's pipes and shared data.
 */
import { emptyFormState, rememberPage, takeFormState } from './form-state'
import { AST_FORMAT_VERSION, type CheckedTemplate, type TemplateAst } from './ast'
import { error, type Diagnostic } from './diagnostics'
import { check } from './check/check'
import { componentTag, layoutResolver, templateName, type Project } from './check/project'
import { CLIENT_SCRIPT_FILE, NO_STRIPPER, fnv1a, injectScripts } from './client-scripts'
import { parse } from './parse/template'
import { BUILTIN_PIPES } from './pipes/builtins'
import { pipesFor, type EnvPipe } from './pipes/env'
import { render, RenderError, type Pipe } from './render/render'

export interface Loader {
  /** Every template name (`users/show`, `components/user-card`). */
  list(): Promise<string[]>
  read(name: string): Promise<string>
  /** Changes when the source changes (an mtime); checked on every render in dev. */
  version?(name: string): Promise<number>
}

/** What a build emits: checked templates as data. */
export interface ViewsBundle {
  v: number
  templates: Record<string, CheckedTemplate>
}

export interface RenderOptions {
  /** A layout for this render, or `false` for none at all (htmx and other partial responses). */
  layout?: boolean | string
  locale?: string
  timeZone?: string
}

export interface ViewsOptions {
  /** Default `src/views`. */
  viewsDir?: string
  /** Default `components`, inside the views folder. */
  componentsDir?: string
  /** Default `src/views/pipes.ts`. Read when `pipes` isn't given and there is no bundle. */
  pipesFile?: string
  pipes?: Record<string, Pipe | EnvPipe>
  /**
   * The layout a page gets when it declares none: one name, or folder prefix →
   * layout (`{ admin: 'layouts/admin', '': 'layouts/main' }`; the longest prefix wins).
   */
  layout?: string | Record<string, string>
  /** The shell (CSS, assets, SEO tags) wrapped around every page's outermost layout. */
  baseLayout?: string
  /** Default `en-US`. */
  locale?: string
  /** Default `UTC`. */
  timeZone?: string
  /** Unresolved names and values that can't print become errors. */
  strict?: boolean
  /** Default `true`. `false` re-reads and re-checks on every render. */
  cache?: boolean
  /** Data every render gets, under the page's own: the current user, a CSP nonce. */
  share?: (ctx: unknown) => object | Promise<object>
  loader?: Loader
  /** Checked templates from the build (`virtual:kick-views`); `null` in dev. */
  bundle?: ViewsBundle | null
  /** Re-check templates whose source changed, on every render. Default: on when `bundle` is `null` (`kick dev`). */
  dev?: boolean
  /**
   * `@assets('entry')`: usually `(entry, data) => assetTags(entry, mode, data.cspNonce)`.
   * `data` is the page's data with shared data merged in.
   */
  assets?: (entry: string, data: Record<string, unknown>) => string
  warn?: (message: string) => void
  /** Strips a `<script client>`'s TypeScript when a build hasn't. Default: Node's `stripTypeScriptTypes` (22.13+), on the Node entry. */
  stripTypes?: (code: string) => string | Promise<string>
  /** Where component scripts are served. Default `'/_kick/c'`. */
  clientScriptPath?: string
}

export interface Views {
  render(name: string, data?: object, opts?: RenderOptions & { ctx?: unknown }): Promise<string>
  /** A component's script by its served file name (`<tag>.<hash>.js`); `undefined` when there's none by that name. */
  clientScript(file: string): Promise<string | undefined>
  /** The path component scripts are served under (`clientScriptPath`). */
  readonly clientScriptPath: string
  /** Whether `name` is one of these views — `ctx.render` falls through to another engine when not. */
  has(name: string): Promise<boolean>
}

export function bundleLoader(bundle: ViewsBundle): Loader {
  if (bundle.v !== AST_FORMAT_VERSION) {
    throw new Error(`views bundle format v${bundle.v}, this runtime reads v${AST_FORMAT_VERSION}`)
  }
  return {
    list: async () => Object.keys(bundle.templates),
    read: async () => {
      throw new Error('a bundled template has no source')
    },
  }
}

interface State {
  project: Project
  /** Syntax errors from parsing, raised when the template is first used. */
  parseErrors: Map<string, Diagnostic>
  versions: Map<string, number>
  checked: Map<string, CheckedTemplate>
}

type FileLoaderModule = typeof import('./loaders/file')

/**
 * How `createViews` reaches the file loader when it's given neither a loader
 * nor a bundle. The Node entry sets it; the edge entry (`workerd`, `worker`,
 * `browser` conditions) doesn't, so an edge build never contains `node:fs`.
 */
let fileLoaderModule: (() => Promise<FileLoaderModule>) | undefined

export function useFileLoader(load: () => Promise<FileLoaderModule>): void {
  fileLoaderModule = load
}

/** The TypeScript stripper for `<script client>`; the Node entry sets it. */
let typeStripper: ((code: string) => string) | undefined

export function useStripTypes(strip: (code: string) => string): void {
  typeStripper = strip
}

function fileLoaders(): Promise<FileLoaderModule> {
  if (!fileLoaderModule) {
    return Promise.reject(
      new Error(
        "createViews has no templates: pass the build's bundle (import kickViews from 'virtual:kick-views') or a loader",
      ),
    )
  }
  return fileLoaderModule()
}

export function createViews(options: ViewsOptions = {}): Views {
  const bundle = options.bundle ?? undefined
  // `kick dev` hands over `bundle: null`: the sources change under us there.
  const dev = options.dev ?? options.bundle === null
  if (bundle) bundleLoader(bundle) // version check
  const componentsDir = options.componentsDir ?? 'components'
  const scriptPath = (options.clientScriptPath ?? '/_kick/c').replace(/\/+$/, '')
  const stripTypes =
    options.stripTypes ??
    ((code: string) => {
      if (!typeStripper) throw new Error(NO_STRIPPER)
      return typeStripper(code)
    })
  /** Each component's served script, kept while its source stays the same. */
  const scripts = new Map<string, { code: string; js: Promise<{ js: string; hash: string }> }>()
  const scriptFor = (t: CheckedTemplate) => {
    const client = t.client!
    const hit = scripts.get(t.name)
    if (hit?.code === client.code) return hit.js
    const js = Promise.resolve(client.js ? client.code : stripTypes(client.code)).then((code) => ({
      js: code,
      hash: fnv1a(code),
    }))
    // A failed strip isn't kept: the next render tries again.
    js.catch(() => scripts.get(t.name)?.js === js && scripts.delete(t.name))
    scripts.set(t.name, { code: client.code, js })
    return js
  }
  const layoutFor = layoutResolver(options.layout)
  const warn = options.warn ?? ((m: string) => console.warn(`[kick/view] ${m}`))
  let loader: Promise<Loader> | undefined
  let appPipes: Promise<Record<string, Pipe | EnvPipe>> | undefined
  let state: Promise<State> | undefined
  /**
   * A memoised promise forgets itself when it rejects: a load that failed
   * once (a file mid-save, too many open files) is retried on the next
   * render rather than failing every render after it.
   */
  const settle = <T>(p: Promise<T>, forget: () => void): Promise<T> =>
    p.catch((err: unknown) => {
      forget()
      throw err
    })

  const getLoader = (): Promise<Loader> =>
    (loader ??= settle(
      options.loader
        ? Promise.resolve(options.loader)
        : fileLoaders().then((m) => m.fileLoader(options.viewsDir ?? 'src/views')),
      () => (loader = undefined),
    ))

  const getPipes = (): Promise<Record<string, Pipe | EnvPipe>> =>
    (appPipes ??= settle(
      options.pipes || bundle
        ? Promise.resolve(options.pipes ?? {})
        : fileLoaders()
            .then((m) => m.loadPipesFile(options.pipesFile ?? 'src/views/pipes.ts'))
            .then((mod) => (mod ?? {}) as Record<string, Pipe | EnvPipe>),
      () => (appPipes = undefined),
    ))

  /** A fresh load, forgotten if it fails. */
  const reload = (): Promise<State> => (state = settle(load(), () => (state = undefined)))

  async function load(): Promise<State> {
    const l = await getLoader()
    const pipes = await getPipes()
    const names = await l.list()
    const templates = new Map<string, TemplateAst>()
    const versions = new Map<string, number>()
    const parseErrors = new Map<string, Diagnostic>()
    await Promise.all(
      names.map(async (name) => {
        const r = parse(await l.read(name), `${name}.kick`)
        templates.set(name, r.ast)
        const first = r.diagnostics.find((d) => d.severity === 'error')
        if (first) parseErrors.set(name, first)
        if (dev && l.version) versions.set(name, await l.version(name))
      }),
    )
    return {
      project: {
        templates,
        pipes: new Set([...BUILTIN_PIPES, ...Object.keys(pipes)]),
        componentsDir,
        layouts: options.layout,
        baseLayout: options.baseLayout,
      },
      versions,
      parseErrors,
      checked: new Map(),
    }
  }

  /** The current state, reloaded in dev when a source changed. */
  async function current(): Promise<State> {
    if (options.cache === false) return reload()
    const s = await (state ?? reload())
    if (!dev) return s
    const l = await getLoader()
    if (!l.version) return s
    const names = await l.list()
    const stale =
      names.length !== s.project.templates.size ||
      (await Promise.all(names.map(async (n) => (await l.version!(n)) !== s.versions.get(n)))).some(
        Boolean,
      )
    if (!stale) return s
    return reload()
  }

  function checked(s: State, name: string): CheckedTemplate {
    let t = s.checked.get(name)
    if (t) return t
    const syntax = s.parseErrors.get(name)
    if (syntax) throw new RenderError(syntax)
    const r = check(name, s.project)
    if (!r.template) {
      const d = r.diagnostics.find((x) => x.severity === 'error')!
      throw new RenderError(d)
    }
    for (const w of r.diagnostics) {
      warn(`${w.file}:${w.span.start.line}:${w.span.start.column} — ${w.message}`)
    }
    t = r.template
    s.checked.set(name, t)
    return t
  }

  async function has(name: string): Promise<boolean> {
    if (!templateName(name)) return false
    if (bundle) return Object.hasOwn(bundle.templates, name)
    return (await current()).project.templates.has(name)
  }

  return {
    has,
    async render(name, data = {}, opts = {}) {
      if (!templateName(name)) throw new Error(`invalid template name '${name}'`)
      if (!(await has(name))) throw new Error(`template '${name}' not found`)
      const resolve = bundle
        ? (n: string) => {
            const t = Object.hasOwn(bundle.templates, n) ? bundle.templates[n] : undefined
            if (!t) throw new RenderError(error(`${n}.kick`, zeroSpan, `template '${n}' not found`))
            return t
          }
        : await current().then((s) => (n: string) => checked(s, n))
      const template = resolve(name)
      rememberPage(opts.ctx, opts.layout)
      const shared = options.share ? await options.share(opts.ctx) : {}
      const locale = opts.locale ?? options.locale ?? 'en-US'
      const timeZone = opts.timeZone ?? options.timeZone ?? 'UTC'
      const used = new Map<string, CheckedTemplate>()
      const html = render(
        template,
        // A controller's own `$errors` / `$old` (a re-render) win over the session's.
        { ...emptyFormState(), ...shared, ...takeFormState(opts.ctx), ...data },
        {
          locale,
          timeZone,
          strict: options.strict ?? false,
          pipes: pipesFor(await getPipes(), { locale, timeZone }),
          warn,
          resolve,
          layoutFor,
          baseLayout: options.baseLayout,
          assets: options.assets,
          clientScript: (t) => used.set(t.name, t),
        },
        { layout: opts.layout },
      )
      if (!used.size) return html
      const nonce = (data as { cspNonce?: unknown }).cspNonce
      const nonceAttr = typeof nonce === 'string' ? ` nonce="${nonce.replace(/"/g, '&quot;')}"` : ''
      const tags = await Promise.all(
        [...used.values()].map(async (t) => {
          const { hash } = await scriptFor(t)
          const file = `${componentTag(t.name, componentsDir)}.${hash}.js`
          return `<script type="module" src="${scriptPath}/${file}"${nonceAttr}></script>`
        }),
      )
      return injectScripts(html, tags.join(''))
    },
    clientScriptPath: scriptPath,
    async clientScript(file) {
      const m = CLIENT_SCRIPT_FILE.exec(file)
      if (!m) return undefined
      const names = bundle
        ? Object.keys(bundle.templates)
        : [...(await current()).project.templates.keys()]
      const name = names.find(
        (n) => n.startsWith(`${componentsDir}/`) && componentTag(n, componentsDir) === m[1],
      )
      if (!name) return undefined
      const t = bundle ? bundle.templates[name]! : checked(await current(), name)
      if (!t.client) return undefined
      const { js, hash } = await scriptFor(t)
      return hash === m[2] ? js : undefined
    },
  }
}

const zeroSpan = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 0, line: 1, column: 1 },
}
