/**
 * Page responses. `inertia(component, props)` is a handler return value: on a
 * first visit it renders the HTML shell with the page embedded, on an Inertia
 * visit (`X-Inertia: true`) it sends the page object as JSON.
 *
 * @module @forinda/kickjs-inertia/inertia
 */
import { RESPOND, type RequestContext, type Respondable } from '@forinda/kickjs'
import { isInertiaProp, propKind, resolveProp } from './props'

export const ERRORS_KEY = '__inertia_errors'
export const FLASH_KEY = '__inertia_flash'
/** URL of the last page rendered — where a failed submit goes back to. */
export const PREVIOUS_KEY = '__inertia_previous'

/** The page object the Inertia client renders — see the protocol docs. */
export interface Page {
  component: string
  props: Record<string, unknown> & { errors: Record<string, unknown> }
  url: string
  version: string | null
  flash: Record<string, unknown>
  sharedProps?: string[]
  deferredProps?: Record<string, string[]>
  mergeProps?: string[]
  prependProps?: string[]
  deepMergeProps?: string[]
  encryptHistory?: boolean
  clearHistory?: boolean
}

export interface PageOptions {
  /** Encrypt this page's history entry in the browser. */
  encryptHistory?: boolean
  /** Wipe the browser's Inertia history, e.g. after logout. */
  clearHistory?: boolean
  /** Response status. Default 200; error pages send theirs (404, 500). */
  status?: number
}

/** What the adapter hands the page renderer. Set in `beforeMount`. */
export interface InertiaRuntime {
  version(): string | null
  share?(ctx: RequestContext): Record<string, unknown> | Promise<Record<string, unknown>>
  renderHtml(page: Page, ctx: RequestContext): Promise<string>
  /** Component that renders error and not-found pages, when configured. */
  errorPage?: string
}

// ponytail: one active adapter per process, which is one app. An app booting
// two Inertia apps in one process would need this keyed per Application.
let active: InertiaRuntime | null = null

export function setInertiaRuntime(runtime: InertiaRuntime | null): void {
  active = runtime
}

/** The active adapter's runtime, or null when no InertiaAdapter is mounted. */
export function inertiaRuntime(): InertiaRuntime | null {
  return active
}

function runtime(): InertiaRuntime {
  if (!active) {
    throw new Error(
      'inertia() needs InertiaAdapter — add it to bootstrap({ adapters: [InertiaAdapter({ entry })] }).',
    )
  }
  return active
}

function header(ctx: RequestContext, name: string): string | undefined {
  const value = (ctx.headers as Record<string, string | string[] | undefined>)[name]
  return Array.isArray(value) ? value[0] : value
}

function list(value: string | undefined): string[] {
  return value
    ? value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : []
}

export function requestUrl(req: unknown): string {
  const r = req as { originalUrl?: string; url?: string }
  return r.originalUrl ?? r.url ?? '/'
}

export function isInertiaRequest(ctx: RequestContext): boolean {
  return header(ctx, 'x-inertia') === 'true'
}

/** Read and remove a one-request value from the session. */
function take(ctx: RequestContext, key: string): Record<string, unknown> {
  const data = ctx.session?.data
  if (!data || data[key] === undefined) return {}
  const value = data[key] as Record<string, unknown>
  delete data[key]
  return value
}

/** Flash data for the next page, sent as the page's top-level `flash`. */
export function flash(ctx: RequestContext, data: Record<string, unknown>): void {
  const session = ctx.session
  if (!session) throw new Error('flash() needs the session() middleware.')
  session.data[FLASH_KEY] = { ...(session.data[FLASH_KEY] as object), ...data }
}

export async function buildPage(
  ctx: RequestContext,
  component: string,
  props: Record<string, unknown>,
  options: PageOptions = {},
): Promise<Page> {
  const rt = runtime()
  const shared = (await rt.share?.(ctx)) ?? {}
  const all: Record<string, unknown> = { ...shared, ...props }

  const partial = header(ctx, 'x-inertia-partial-component') === component
  const only = partial ? list(header(ctx, 'x-inertia-partial-data')) : []
  const except = partial ? list(header(ctx, 'x-inertia-partial-except')) : []
  const reset = list(header(ctx, 'x-inertia-reset'))

  // A dot path in `only` ('users.data') still selects its top-level prop.
  const named = (key: string) => only.some((o) => o === key || o.startsWith(`${key}.`))

  const resolved: Record<string, unknown> = {}
  const deferredProps: Record<string, string[]> = {}
  const merges = { append: [] as string[], prepend: [] as string[], deep: [] as string[] }

  for (const [key, value] of Object.entries(all)) {
    const kind = isInertiaProp(value) ? propKind(value) : undefined
    let send: boolean
    if (kind === 'always') send = true
    else if (partial) send = (only.length === 0 || named(key)) && !except.includes(key)
    else send = kind !== 'optional' && kind !== 'defer'

    if (!send) {
      if (!partial && kind === 'defer' && isInertiaProp(value)) {
        const group = value.group ?? 'default'
        ;(deferredProps[group] ??= []).push(key)
      }
      continue
    }
    resolved[key] = await resolveProp(value)
    if (kind === 'merge' && isInertiaProp(value) && !reset.includes(key)) {
      merges[value.mode ?? 'append'].push(key)
    }
  }

  const page: Page = {
    component,
    props: { ...resolved, errors: take(ctx, ERRORS_KEY) },
    url: requestUrl(ctx.req),
    version: rt.version(),
    flash: take(ctx, FLASH_KEY),
  }
  const sharedKeys = Object.keys(shared)
  if (sharedKeys.length) page.sharedProps = sharedKeys
  if (Object.keys(deferredProps).length) page.deferredProps = deferredProps
  if (merges.append.length) page.mergeProps = merges.append
  if (merges.prepend.length) page.prependProps = merges.prepend
  if (merges.deep.length) page.deepMergeProps = merges.deep
  if (options.encryptHistory) page.encryptHistory = true
  if (options.clearHistory) page.clearHistory = true
  return page
}

/**
 * Render an Inertia page. Return it from a handler:
 *
 * ```ts
 * @Get('/users')
 * async index() {
 *   return inertia('Users/Index', { users: await this.users.list() })
 * }
 * ```
 */
export function inertia(
  component: string,
  props: Record<string, unknown> = {},
  options?: PageOptions,
): Respondable {
  return {
    async [RESPOND](ctx: RequestContext) {
      const page = await buildPage(ctx, component, props, options)
      // Remembered for back(): helmet's default Referrer-Policy (no-referrer)
      // means the browser sends no Referer to go back to.
      if (ctx.session) ctx.session.data[PREVIOUS_KEY] = page.url
      // `Vary: X-Inertia` is added by the adapter's middleware, which can
      // append to a Vary another layer set instead of replacing it.
      if (isInertiaRequest(ctx)) {
        ctx.setHeader('X-Inertia', 'true')
        ctx.json(page, options?.status ?? 200)
        return
      }
      ctx.html(await runtime().renderHtml(page, ctx), options?.status ?? 200)
    },
  }
}

/**
 * Redirect after a form submit. Uses 303 for anything but GET, so the browser
 * follows with a GET, and saves the session first so flashed errors and
 * messages are there when that GET arrives.
 */
export function redirect(url: string): Respondable {
  return {
    async [RESPOND](ctx: RequestContext) {
      await ctx.session?.save()
      const method = (ctx.req as { method?: string }).method ?? 'GET'
      ctx.redirect(url, method === 'GET' ? 302 : 303)
    },
  }
}

/** A path on this site — not `//host` or `/\\host`, which browsers treat as another origin. */
function localPath(value: unknown): string | undefined {
  return typeof value === 'string' && /^\/(?![/\\])/.test(value) ? value : undefined
}

/** The path of a Referer, only when it points at this host. */
function sameOriginPath(referer: string | undefined, host: string | undefined): string | undefined {
  if (!referer || !host) return undefined
  try {
    const url = new URL(referer)
    return url.host === host ? localPath(url.pathname + url.search) : undefined
  } catch {
    return undefined
  }
}

/**
 * Where "back" is: the last page this session rendered, else a same-origin
 * Referer, else `fallback`. Never another site — a form on another site that
 * posts here must not be able to choose where the user lands.
 */
export function previousUrl(
  session: { data: Record<string, unknown> } | undefined,
  headers: { referer?: string | string[]; host?: string | string[] },
  fallback = '/',
): string {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  return (
    localPath(session?.data[PREVIOUS_KEY]) ??
    sameOriginPath(one(headers.referer), one(headers.host)) ??
    fallback
  )
}

/** Redirect back to the page the request came from. */
export function back(ctx: RequestContext, fallback = '/'): Respondable {
  return redirect(
    previousUrl(
      ctx.session,
      { referer: header(ctx, 'referer'), host: header(ctx, 'host') },
      fallback,
    ),
  )
}

/**
 * A full browser visit, outside Inertia — another site, or a page that is not
 * an Inertia page. An Inertia request gets 409 + `X-Inertia-Location`, which
 * the client turns into `window.location`.
 */
export function location(url: string): Respondable {
  return {
    async [RESPOND](ctx: RequestContext) {
      if (isInertiaRequest(ctx)) {
        ctx.setHeader('X-Inertia-Location', url)
        ctx.html('', 409)
        return
      }
      ctx.redirect(url)
    },
  }
}

/** A browser navigation or an Inertia visit — not an API or asset request. */
export function isPageRequest(headers: Record<string, string | string[] | undefined>): boolean {
  const accept = String(headers.accept ?? '')
  return headers['x-inertia'] === 'true' || accept.includes('text/html')
}

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Page Not Found',
  405: 'Method Not Allowed',
  419: 'Page Expired',
  429: 'Too Many Requests',
  500: 'Server Error',
  503: 'Service Unavailable',
}

/**
 * The configured error page as a response, with `{ status, message }` as its
 * props. A 5xx message is replaced in production — an exception's text is
 * for the log, not the visitor.
 */
export function errorPage(component: string, status: number, error?: unknown): Respondable {
  const fallback = STATUS_TEXT[status] ?? (status >= 500 ? 'Server Error' : 'Error')
  const raw = error instanceof Error && error.message ? error.message : fallback
  const message = status >= 500 && process.env.NODE_ENV === 'production' ? fallback : raw
  return inertia(component, { status, message }, { status })
}
