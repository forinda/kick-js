/**
 * `createViews`: templates from a loader or a build's bundle, checked once
 * and cached, rendered with the app's pipes and shared data.
 */
import type {
  LooseViewName,
  ViewFragmentData,
  ViewFragmentNames,
  ViewName,
  ViewRenderArgs,
} from './types'
import { emptyFormState, rememberPage, takeFormState } from './form-state'
import { AST_FORMAT_VERSION, type CheckedTemplate, type TemplateAst } from './ast'
import { error, type Diagnostic } from './diagnostics'
import { check } from './check/check'
import {
  componentTag,
  isComponent,
  layoutResolver,
  templateName,
  type Project,
} from './check/project'
import {
  CLIENT_SCRIPT_FILE,
  NO_STRIPPER,
  contentType,
  fnv1a,
  hasImports,
  injectHead,
  injectScripts,
} from './client-scripts'
import { VALIDATE_RUNTIME, VALIDATORS_REGISTER } from './validate-runtime'
import { readValidatorExports, VALIDATORS_TAG } from './validators'

/** The validator script's served name; component tags can't take it. */
const VALIDATE_TAG = 'kick-validate'
const VALIDATE_HASH = fnv1a(VALIDATE_RUNTIME)
import { parse } from './parse/template'
import { catalogIndex, createTranslator, type Messages } from './i18n'
import { BUILTIN_PIPES, OVERRIDABLE_PIPES, type PipeEnv } from './pipes/builtins'
import { pipesFor, type EnvPipe } from './pipes/env'
import { render, RenderError, type Pipe } from './render/render'

/** Where `createViews` reads template sources from. */
export interface Loader {
  /** Every template name (`users/show`, `components/user-card`). */
  list(): Promise<string[]>
  read(name: string): Promise<string>
  /** Changes when the source changes (an mtime); checked on every render in dev. */
  version?(name: string): Promise<number>
  /** The file `name` came from, for messages (default `<name>.kick`). */
  file?(name: string): string
}

/** What a build emits: checked templates as data. */
export interface ViewsBundle {
  v: number
  templates: Record<string, CheckedTemplate>
  /** Client scripts bundled by the build: each component's entry file, and every file (entries and shared chunks). */
  client?: {
    entries: Record<string, string>
    /** Each entry's stylesheets, by component tag. */
    css?: Record<string, string[]>
    /** Files kept in the bundle (`clientFiles: 'bundle'`). */
    files?: Record<string, string>
    /** Files the build wrote to disk, under `clientDir` (`clientFiles: 'disk'`). */
    disk?: string[]
  }
}

/** Per-render options: layout, locale and time zone. */
export interface RenderOptions {
  /** A layout for this render, or `false` for none at all (htmx and other partial responses). */
  layout?: boolean | string
  /**
   * Render only these `@fragment`s of the page, in order, without layouts —
   * an htmx swap (several for out-of-band swaps).
   */
  fragment?: string | readonly string[]
  locale?: string
  timeZone?: string
}

/** What `share` can read from the request: KickJS's `RequestContext` has both. */
export interface ShareContext {
  req: unknown
  get(key: string): unknown
}

/** Options for `createViews` and `KickView`. */
export interface ViewsOptions {
  /** Default `src/views`. */
  viewsDir?: string
  /**
   * More view folders, by name (absolute paths): `{ billing: '/app/src/modules/billing/views' }`
   * renders `billing::invoices/show`. The Vite plugin fills it in from kick.config's `views.roots`.
   */
  roots?: Record<string, string>
  /** Default `components`, inside the views folder. */
  componentsDir?: string
  /** Default `src/views/pipes.ts`. Read when `pipes` isn't given and there is no bundle. */
  pipesFile?: string
  /** Default `<viewsDir>/validators.ts`: the app's browser validators. Read when there is no bundle. */
  validatorsFile?: string
  pipes?: Record<string, Pipe | EnvPipe>
  /**
   * Message catalogues for `t`: locale → dot key → message. Default: read from
   * `<viewsDir>/locales/*.json` (the Vite plugin bundles them as `messages`).
   */
  messages?: Messages
  /** The locale a message falls back to. Default: `locale`, else `en-US`. */
  messagesLocale?: string
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
  /**
   * Data every render gets, under the page's own: the current user, a CSP nonce.
   * `ctx` is the request the page renders in (KickJS's `RequestContext`), or
   * `undefined` outside one.
   */
  share?: (ctx: ShareContext | undefined) => object | Promise<object>
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
  /** A `file:` URL of the folder holding the bundle's `disk` files; `virtual:kick-views` exports it. */
  clientDir?: string
}

/** A views instance: renders templates and serves component client scripts. */
export interface Views {
  render<N extends ViewName>(name: N, ...args: ViewRenderArgs<N>): Promise<string>
  render<N extends ViewName, const F extends ViewFragmentNames<N>>(
    name: N,
    data: ViewFragmentData<N, F>,
    opts: RenderOptions & { fragment: F; ctx?: unknown },
  ): Promise<string>
  render<N extends string>(
    name: N & LooseViewName<N>,
    data?: object,
    opts?: RenderOptions & { ctx?: unknown },
  ): Promise<string>
  /** A component's script by its served file name (`<tag>.<hash>.js`); `undefined` when there's none by that name. */
  clientScript(file: string): Promise<string | undefined>
  /** A client file (script, stylesheet, asset) by its served name, with its content type. */
  clientFile(file: string): Promise<{ body: string | Uint8Array; type: string } | undefined>
  /** The path component scripts are served under (`clientScriptPath`). */
  readonly clientScriptPath: string
  /** Whether `name` is one of these views — `ctx.render` falls through to another engine when not. */
  has(name: string): Promise<boolean>
  /** A message from the catalogues, as `t` prints it: for controllers, emails and flash messages. */
  t(key: string, params?: Record<string, unknown>, opts?: { locale?: string }): Promise<string>
}

/** A loader over a build's bundle; throws when the bundle's format version doesn't match this runtime. */
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
  /** `validators.ts`'s source, when there's one and no bundle. */
  validators?: string
  /** Syntax errors from parsing, raised when the template is first used. */
  parseErrors: Map<string, Diagnostic>
  versions: Map<string, number>
  checked: Map<string, CheckedTemplate>
}

type FileLoaderModule = typeof import('./loaders/file')

let fileLoaderModule: (() => Promise<FileLoaderModule>) | undefined

/**
 * How `createViews` reaches the file loader when it's given neither a loader
 * nor a bundle. The Node entry sets it; the edge entry (`workerd`, `worker`,
 * `browser` conditions) doesn't, so an edge build never contains `node:fs`.
 */
export function useFileLoader(load: () => Promise<FileLoaderModule>): void {
  fileLoaderModule = load
}

let typeStripper: ((code: string) => string) | undefined

/** The TypeScript stripper for `<script client>`; the Node entry sets it. */
export function useStripTypes(strip: (code: string) => string): void {
  typeStripper = strip
}

let clientReader: ((url: URL) => Promise<Uint8Array>) | undefined

/** Reads a client file the build wrote to disk; the Node entry sets it. */
export function useClientFiles(read: ((url: URL) => Promise<Uint8Array>) | undefined): void {
  clientReader = read
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

/**
 * Creates a views instance: templates from a loader or a build's bundle, checked on first use
 * and cached, rendered with the app's pipes and shared data. Use it directly to render
 * outside a request (emails, tests), or pass it to `KickView({ views })`.
 *
 * @example
 * ```ts
 * const views = createViews({ layout: 'layouts/main' })
 * const html = await views.render('emails/welcome', { user })
 * ```
 *
 * @see https://kickjs.app/guide/views
 */
export function createViews(options: ViewsOptions = {}): Views {
  const bundle = options.bundle ?? undefined
  // `kick dev` hands over `bundle: null`: the sources change under us there.
  const dev = options.dev ?? options.bundle === null
  if (bundle) bundleLoader(bundle) // version check
  const componentsDir = options.componentsDir ?? 'components'
  const disk = new Set(bundle?.client?.disk)
  const scriptPath = (options.clientScriptPath ?? '/_kick/c').replace(/\/+$/, '')
  const stripTypes =
    options.stripTypes ??
    ((code: string) => {
      if (!typeStripper) throw new Error(NO_STRIPPER)
      return typeStripper(code)
    })
  // Beside the views, as the build, the editor and `kick check:views` look for it.
  const validatorsFile =
    options.validatorsFile ??
    `${(options.viewsDir ?? 'src/views').replace(/\/+$/, '')}/validators.ts`
  /** `validators.ts` as served without a bundle, kept while its source stays the same. */
  let validatorsJs: { source: string; js: Promise<{ js: string; hash: string }> } | undefined
  const validatorsScript = (source: string): Promise<{ js: string; hash: string }> => {
    // Without a bundler (no build, not kick dev) imports can't be resolved.
    if (options.bundle === undefined && hasImports(source))
      return Promise.reject(new Error('client scripts that import need kick dev or a kick build'))
    if (validatorsJs?.source === source) return validatorsJs.js
    // kick dev: Vite serves it (the plugin answers first); the hash only names it.
    const js = (
      options.bundle === null
        ? Promise.resolve(source)
        : // A plain `.js` file has no types to strip.
          Promise.resolve(/\.m?js$/.test(validatorsFile) ? source : stripTypes(source)).then(
            (code) => code + VALIDATORS_REGISTER,
          )
    ).then((code) => ({ js: code, hash: fnv1a(code) }))
    js.catch(() => validatorsJs?.js === js && (validatorsJs = undefined))
    validatorsJs = { source, js }
    return js
  }
  /** Each component's served script, kept while its source stays the same. */
  const scripts = new Map<string, { code: string; js: Promise<{ js: string; hash: string }> }>()
  const scriptFor = (t: CheckedTemplate) => {
    const client = t.client!
    // Without a bundler (no build, not kick dev) imports can't be resolved.
    if (options.bundle === undefined && hasImports(client.code))
      return Promise.reject(new Error('client scripts that import need kick dev or a kick build'))
    const hit = scripts.get(t.name)
    if (hit?.code === client.code) return hit.js
    // kick dev: Vite strips it when serving.
    const raw = client.js || options.bundle === null
    const js = Promise.resolve(raw ? client.code : stripTypes(client.code)).then((code) => ({
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
  if (disk.size && clientReader && !options.clientDir)
    warn(
      "the build wrote client files to disk but createViews has no clientDir: pass { ...kickViews } from 'virtual:kick-views'",
    )
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
        : fileLoaders().then((m) =>
            options.roots && Object.keys(options.roots).length
              ? m.multiRootLoader(options.viewsDir ?? 'src/views', options.roots)
              : m.fileLoader(options.viewsDir ?? 'src/views'),
          ),
      () => (loader = undefined),
    ))

  const defaultLocale = options.messagesLocale ?? options.locale ?? 'en-US'
  const readMessages = async (): Promise<Messages> =>
    options.messages ??
    (bundle
      ? {}
      : ((await (await fileLoaders()).readCatalogs(`${options.viewsDir ?? 'src/views'}/locales`)) ??
        {}))
  let translator: Promise<{ json: string; t: ReturnType<typeof createTranslator> }> | undefined
  /** The message lookup; in dev the catalogues are re-read, keeping the translator while they're unchanged. */
  const getTranslator = async (): Promise<ReturnType<typeof createTranslator>> => {
    const make = async () => {
      const messages = await readMessages()
      return {
        json: JSON.stringify(messages),
        t: createTranslator(messages, { defaultLocale, warn }),
      }
    }
    translator ??= settle(make(), () => (translator = undefined))
    const current = await translator
    if (!dev || options.messages) return current.t
    const messages = await readMessages()
    const json = JSON.stringify(messages)
    if (json === current.json) return current.t
    const next = { json, t: createTranslator(messages, { defaultLocale, warn }) }
    translator = Promise.resolve(next)
    return next.t
  }

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

  /** `validators.ts`'s source, read without a bundle and where there's a file system. */
  const readValidators = async (): Promise<string | undefined> =>
    bundle || !fileLoaderModule
      ? undefined
      : (await fileLoaderModule()).readTextFile(validatorsFile)

  async function load(): Promise<State> {
    const l = await getLoader()
    const pipes = await getPipes()
    const validators = await readValidators()
    const custom =
      validators === undefined ? undefined : readValidatorExports(validators, validatorsFile)
    for (const d of custom?.diagnostics ?? [])
      warn(`${d.file}:${d.span.start.line}:${d.span.start.column} — ${d.message}`)
    const names = await l.list()
    const templates = new Map<string, TemplateAst>()
    const versions = new Map<string, number>()
    const parseErrors = new Map<string, Diagnostic>()
    await Promise.all(
      names.map(async (name) => {
        const r = parse(await l.read(name), l.file?.(name) ?? `${name}.kick`)
        templates.set(name, r.ast)
        const first = r.diagnostics.find((d) => d.severity === 'error')
        if (first) parseErrors.set(name, first)
        if (dev && l.version) versions.set(name, await l.version(name))
      }),
    )
    return {
      project: {
        templates,
        pipes: new Set([...BUILTIN_PIPES, ...OVERRIDABLE_PIPES, ...Object.keys(pipes)]),
        // The app's own `t` isn't checked against catalogues.
        messages: Object.hasOwn(pipes, 't')
          ? undefined
          : catalogIndex(
              await readMessages(),
              options.messages ? 'messages' : `${options.viewsDir ?? 'src/views'}/locales`,
            ),
        validators: new Set(custom?.names),
        componentsDir,
        layouts: options.layout,
        baseLayout: options.baseLayout,
      },
      versions,
      parseErrors,
      checked: new Map(),
      validators,
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
    // An edited validators.ts changes which names check and what's served.
    if (!stale && (await readValidators()) === s.validators) return s
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

  const views: Views = {
    has,
    t: async (key, params = {}, o = {}) =>
      (await getTranslator())(o.locale ?? options.locale ?? 'en-US', key, params),
    async render(name: string, data: object = {}, opts: RenderOptions & { ctx?: unknown } = {}) {
      if (!templateName(name)) throw new Error(`invalid template name '${name}'`)
      if (!(await has(name))) throw new Error(`template '${name}' not found`)
      const st = bundle ? undefined : await current()
      const resolve = bundle
        ? (n: string) => {
            const t = Object.hasOwn(bundle.templates, n) ? bundle.templates[n] : undefined
            if (!t) throw new RenderError(error(`${n}.kick`, zeroSpan, `template '${n}' not found`))
            return t
          }
        : (n: string) => checked(st!, n)
      const template = resolve(name)
      // A fragment isn't a page a form posts back to.
      if (opts.fragment === undefined) rememberPage(opts.ctx, opts.layout)
      const shared = options.share ? await options.share(opts.ctx as ShareContext | undefined) : {}
      const locale = opts.locale ?? options.locale ?? 'en-US'
      const timeZone = opts.timeZone ?? options.timeZone ?? 'UTC'
      const tr = await getTranslator()
      const used = new Map<string, CheckedTemplate>()
      let validation = false
      // A controller's own `$errors` / `$old` (a re-render) win over the session's.
      // Low to high: the page's @input defaults, form state's empty bags,
      // share(), the request's form state, the controller's data.
      const page = {
        ...template.defaults,
        ...emptyFormState(),
        ...shared,
        ...takeFormState(opts.ctx),
        ...data,
      }
      const html = render(
        template,
        page,
        {
          locale,
          timeZone,
          strict: options.strict ?? false,
          pipes: pipesFor(await getPipes(), {
            locale,
            timeZone,
            urlFor: urlForOf(opts.ctx),
            translate: (key, params) => tr(locale, key, params),
          }),
          warn,
          resolve,
          layoutFor,
          baseLayout: options.baseLayout,
          assets: options.assets,
          clientScript: (t) => used.set(t.name, t),
          validation: () => (validation = true),
        },
        { layout: opts.layout, fragment: opts.fragment, callerData: data },
      )
      if (!used.size && !validation) return html
      // The nonce `@assets` gets too: often from share().
      const nonce = (page as { cspNonce?: unknown }).cspNonce
      const nonceAttr = typeof nonce === 'string' ? ` nonce="${nonce.replace(/"/g, '&quot;')}"` : ''
      const tags = await Promise.all(
        [...used.values()].map(async (t) => {
          const tag = componentTag(t.name, componentsDir)
          // Bundled by the build: its entry, which imports its chunks.
          const entry = bundle?.client?.entries[tag]
          const file = entry ?? `${tag}.${(await scriptFor(t)).hash}.js`
          return `<script type="module" src="${scriptPath}/${file}"${nonceAttr}></script>`
        }),
      )
      if (validation) {
        tags.push(
          `<script type="module" src="${scriptPath}/${VALIDATE_TAG}.${VALIDATE_HASH}.js"${nonceAttr}></script>`,
        )
        // The app's validators.ts, registering into the script above.
        const custom = bundle
          ? bundle.client?.entries[VALIDATORS_TAG]
          : st?.validators !== undefined
            ? `${VALIDATORS_TAG}.${(await validatorsScript(st.validators)).hash}.js`
            : undefined
        if (custom)
          tags.push(`<script type="module" src="${scriptPath}/${custom}"${nonceAttr}></script>`)
      }
      // Stylesheets the bundled scripts import, once each, in the head.
      const css = new Set([
        ...[...used.values()].flatMap(
          (t) => bundle?.client?.css?.[componentTag(t.name, componentsDir)] ?? [],
        ),
        ...((validation && bundle?.client?.css?.[VALIDATORS_TAG]) || []),
      ])
      const links = [...css]
        .map((f) => `<link rel="stylesheet" href="${scriptPath}/${f}"${nonceAttr}>`)
        .join('')
      return injectScripts(links ? injectHead(html, links) : html, tags.join(''))
    },
    clientScriptPath: scriptPath,
    async clientScript(file) {
      const m = CLIENT_SCRIPT_FILE.exec(file)
      if (!m) return undefined
      if (m[1] === VALIDATE_TAG)
        return m[2] === VALIDATE_HASH && m[3] === 'js' ? VALIDATE_RUNTIME : undefined
      const files = bundle?.client?.files
      if (files) return Object.hasOwn(files, file) ? files[file] : undefined
      if (m[1] === VALIDATORS_TAG) {
        // A build serves its own file; kick dev's plugin serves it through Vite.
        if (options.bundle !== undefined || m[3] !== 'js') return undefined
        const source = (await current()).validators
        if (source === undefined) return undefined
        const { js, hash } = await validatorsScript(source)
        return hash === m[2] ? js : undefined
      }
      if (m[3] !== 'js') return undefined
      const names = bundle
        ? Object.keys(bundle.templates)
        : [...(await current()).project.templates.keys()]
      const name = names.find(
        (n) => isComponent(n, componentsDir) && componentTag(n, componentsDir) === m[1],
      )
      if (!name) return undefined
      const t = bundle ? bundle.templates[name]! : checked(await current(), name)
      if (!t.client) return undefined
      const { js, hash } = await scriptFor(t)
      return hash === m[2] ? js : undefined
    },
    async clientFile(file) {
      if (!CLIENT_SCRIPT_FILE.test(file)) return undefined
      // Written by the build: read only names it listed, never a probed path.
      if (disk.has(file)) {
        if (!clientReader || !options.clientDir) return undefined
        try {
          const body = await clientReader(new URL(file, options.clientDir))
          return { body, type: contentType(file) }
        } catch (err) {
          // Not deployed with the server: left to whatever serves static files.
          if ((err as { code?: string }).code === 'ENOENT') return undefined
          throw err
        }
      }
      const text = await views.clientScript(file)
      return text === undefined ? undefined : { body: text, type: contentType(file) }
    },
  }
  return views
}

/** The request's `urlFor`, when the render has a request that has one (KickJS's `RequestContext`). */
function urlForOf(ctx: unknown): PipeEnv['urlFor'] {
  const c = ctx as { urlFor?: (name: string, params: Array<string | number>) => string } | undefined
  return typeof c?.urlFor === 'function' ? (name, params) => c.urlFor!(name, params) : undefined
}

const zeroSpan = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 0, line: 1, column: 1 },
}
