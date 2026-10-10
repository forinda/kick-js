/**
 * Tiny typed wrapper around `fetch` + `EventSource` for the DevTools
 * RPC surface. Handles the auth-token header convention and centralises
 * the base path resolution (`<body data-base="...">` set by the
 * adapter when serving the dashboard).
 */

import type {
  JobDetail,
  JobQueueInfo,
  JobState,
  JobSummary,
  DevtoolsTabDescriptor,
  MemoryHealth,
  RuntimeSnapshot,
  TopologySnapshot,
} from '@forinda/kickjs-devtools-kit'

/** Resolve the base path the adapter mounted the dashboard under. */
export function getBasePath(): string {
  // The adapter writes `<body data-base="/_debug">` so the SPA can be
  // mounted at any path the adopter chose. Default to /_debug if the
  // attribute is missing (e.g. running standalone in vite dev).
  return document.body.dataset.base ?? '/_debug'
}

const TOKEN_COOKIE = 'kickjs_devtools_token'
const TOKEN_TTL_DAYS = 30

/**
 * Resolve the auth token in priority order:
 *   1. URL query param `?token=...` — also writes to cookie + cleans
 *      the URL so refreshes work without re-pasting AND the token
 *      doesn't sit in browser history / shoulder-surfed screenshots.
 *   2. Cookie persisted from a previous URL visit OR the auth-gate
 *      modal.
 *   3. In-memory override set via {@link setToken} — used by the
 *      auth-gate after the user pastes a token; persisted to cookie
 *      simultaneously.
 *   4. null when none of the above resolve.
 */
let _runtimeToken: string | null = null

export function getToken(): string | null {
  if (_runtimeToken) return _runtimeToken
  const fromUrl = new URLSearchParams(location.search).get('token')
  if (fromUrl) {
    setToken(fromUrl)
    const url = new URL(location.href)
    url.searchParams.delete('token')
    history.replaceState({}, '', url.toString())
    return fromUrl
  }
  const match = document.cookie.match(new RegExp(`${TOKEN_COOKIE}=([^;]+)`))
  if (match) {
    // Re-persist: moves a token saved by older versions (path=/) under the
    // dashboard's own path — see setToken.
    setToken(decodeURIComponent(match[1]))
    return _runtimeToken
  }
  return null
}

/**
 * Persist + activate a token. Used by the auth-gate after a successful probe.
 *
 * The cookie is scoped to the dashboard's base path. At `path=/` the browser
 * sent the devtools secret with every request to the app itself, where any
 * request logger or handler could see it. The root-path cookie older
 * versions wrote is expired here too.
 */
export function setToken(token: string): void {
  _runtimeToken = token
  document.cookie = `${TOKEN_COOKIE}=${encodeURIComponent(token)}; path=${getBasePath()}; max-age=${
    60 * 60 * 24 * TOKEN_TTL_DAYS
  }; SameSite=Lax`
  expireRootCookie()
}

/** Wipe the cached token + cookie. */
export function clearToken(): void {
  _runtimeToken = null
  document.cookie = `${TOKEN_COOKIE}=; path=${getBasePath()}; max-age=0; SameSite=Lax`
  expireRootCookie()
}

/** Drop the `path=/` cookie written by versions before the cookie was scoped. */
function expireRootCookie(): void {
  if (getBasePath() === '/') return
  document.cookie = `${TOKEN_COOKIE}=; path=/; max-age=0; SameSite=Lax`
}

function withToken(url: string): string {
  const token = getToken()
  if (!token) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}token=${encodeURIComponent(token)}`
}

/** Sentinel error code so callers can detect "needs token" without parsing strings. */
export class AuthRequiredError extends Error {
  constructor() {
    super('AUTH_REQUIRED')
    this.name = 'AuthRequiredError'
  }
}

/**
 * One-shot GET — throws on non-2xx so callers can rely on the typed
 * return. 401/403 responses throw {@link AuthRequiredError} instead
 * of the generic message so the auth-gate signal can detect them.
 */
async function get<T>(path: string): Promise<T> {
  const url = withToken(`${getBasePath()}${path}`)
  const res = await fetch(url, { headers: tokenHeaders() })
  if (res.status === 401 || res.status === 403) {
    throw new AuthRequiredError()
  }
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`)
  }
  return (await res.json()) as T
}

/**
 * POST to a dashboard endpoint. Throws the server's `{ error }` message
 * (or the status line) on a non-2xx; the caller reads the body it expects.
 */
/** One `@Cron` job as `/_debug/cron` reports it. */
export interface CronJobEntry {
  name: string
  className: string
  handler: string
  expression: string
  timezone?: string
  description?: string
  enabled: boolean
  overlap: boolean
  runOnInit: boolean
  /** Epoch ms of the next tick; null when the app has no `croner` to work it out. */
  nextRunAt: number | null
  stats: {
    runs: number
    failures: number
    running: number
    lastStartedAt?: number
    lastDurationMs?: number
    lastOutcome?: 'ok' | 'failed'
    lastError?: string
  }
}

export async function post(path: string): Promise<Response> {
  const res = await fetch(withToken(`${getBasePath()}${path}`), {
    method: 'POST',
    headers: tokenHeaders(),
  })
  if (res.status === 401 || res.status === 403) throw new AuthRequiredError()
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `${res.status} ${res.statusText}`)
  }
  return res
}

function tokenHeaders(): Record<string, string> {
  const t = getToken()
  return t ? { 'x-devtools-token': t } : {}
}

/** Identity of the Node process the runtime stats describe. */
export interface ProcessInfo {
  nodeVersion: string
  pid: number
  platform: string
  arch: string
  runtime: { name: string; capabilities: Record<string, boolean> } | null
}

/** One logged request — `RequestLogEntry` on the server. */
export interface RequestLogEntry {
  seq: number
  at: number
  method: string
  path: string
  route?: string
  status: number
  durationMs: number
  requestId?: string
  error?: { name: string; message: string }
}

/** Latency and outcome counts for one route (`'GET /users/:id'`). */
export interface RouteLatency {
  count: number
  totalMs: number
  minMs: number
  maxMs: number
  serverErrors: number
  clientErrors: number
  p50: number
  p95: number
  p99: number
  /** Recent samples per `latencyBucketsMs` bucket, plus one for everything slower. */
  histogram: number[]
}

export interface MetricsResponse {
  requests: number
  serverErrors: number
  clientErrors: number
  errorRate: number
  uptimeSeconds: number
  startedAt: string
  routeLatency: Record<string, RouteLatency>
  latencyBucketsMs: number[]
}

/** One job tool's queues, as `/_debug/jobs` reports them. */
export interface JobSource {
  source: string
  /** Optional actions this tool supports. */
  actions: Array<'retry' | 'remove' | 'retryAll' | 'clean' | 'pause' | 'resume'>
  queues: JobQueueInfo[]
  error?: string
}

const qs = (params: Record<string, string | number | undefined>): string =>
  new URLSearchParams(
    Object.entries(params).flatMap(([k, v]) => (v === undefined ? [] : [[k, String(v)]])),
  ).toString()

export const rpc = {
  jobs: () => get<{ sources: JobSource[] }>('/jobs'),
  jobList: (p: { source: string; queue: string; state: JobState; start: number; end: number }) =>
    get<{ jobs: JobSummary[] }>(`/jobs/list?${qs(p)}`),
  job: (p: { source: string; queue: string; id: string }) => get<JobDetail>(`/jobs/job?${qs(p)}`),
  jobAction: async (p: {
    source: string
    queue: string
    action: JobSource['actions'][number]
    id?: string
    state?: JobState
  }) =>
    (await (await post(`/jobs/action?${qs(p)}`)).json()) as {
      ok: true
      count?: number | null
    },
  /** Requests logged after `since` (a `seq`), oldest first. */
  requests: (since = 0) =>
    get<{ requests: RequestLogEntry[]; latest: number }>(`/requests?since=${since}`),
  runtime: () =>
    get<{
      latest: RuntimeSnapshot
      history: RuntimeSnapshot[]
      health: MemoryHealth
      process?: ProcessInfo
    }>('/runtime'),
  topology: () => get<TopologySnapshot>('/topology'),
  /** Request counters and per-route latency. */
  metrics: () => get<MetricsResponse>('/metrics'),
  /** Where a route's handler is declared — for "open in editor". */
  source: (controller: string, handler: string) =>
    get<{ file: string; relative: string; line: number }>(
      `/source?${new URLSearchParams({ controller, handler })}`,
    ),
  /** Route registry — method/path/controller/handler/middleware per route. */
  routeRegistry: () =>
    get<{
      routes: Array<{
        method: string
        path: string
        controller: string
        handler: string
        middleware: string[]
      }>
    }>('/routes'),
  /** DI container registrations with kind/scope/status/dependencies. */
  container: () =>
    get<{
      registrations: Array<{
        token: string
        kind?: string
        scope?: string
        instantiated?: boolean
        resolveCount?: number
        firstResolvedAt?: number
        lastResolvedAt?: number
        resolveDurationMs?: number
        postConstructStatus?: 'done' | 'failed' | 'none'
        dependencies?: string[]
      }>
      count: number
    }>('/container'),
  health: () =>
    get<{
      status: 'healthy' | 'degraded'
      errorRate: number
      uptime: number
      adapters: Record<string, string>
    }>('/health'),
  /** Every `@Cron` job the container can resolve, with its next run and run stats. */
  cron: () => get<{ jobs: CronJobEntry[] }>('/cron'),
  /** Start one cron job now; resolves once it has started, not finished. */
  cronRun: (name: string) => post(`/cron/run?name=${encodeURIComponent(name)}`),
  /** Queue stats — present only when QueueAdapter is mounted. */
  queues: () =>
    get<{
      enabled: boolean
      queues?: Array<{
        name: string
        waiting?: number
        active?: number
        completed?: number
        failed?: number
        delayed?: number
        paused?: number
        error?: string
      }>
    }>('/queues'),
  /** WebSocket stats — present only when WsAdapter is mounted. */
  ws: () =>
    get<{
      enabled: boolean
      activeConnections?: number
      totalConnections?: number
      messagesReceived?: number
      messagesSent?: number
      namespaces?: Record<string, { connections: number; handlers: number; events?: string[] }>
    }>('/ws'),
  tabs: () =>
    get<{
      tabs: DevtoolsTabDescriptor[]
      errors: ReadonlyArray<{ source: string; reason: string }>
    }>('/tabs'),
}

/**
 * Subscribe to an SSE endpoint. Returns an unsubscribe function. Auto-
 * reconnects via the browser's `EventSource` machinery; the `onError`
 * handler runs on each transient failure (typically followed by a
 * silent reconnect).
 */
export function subscribe<T>(
  path: string,
  onMessage: (data: T) => void,
  onError?: (err: Event) => void,
): () => void {
  const url = withToken(`${getBasePath()}${path}`)
  const es = new EventSource(url)
  es.addEventListener('message', (event) => {
    try {
      onMessage(JSON.parse(event.data) as T)
    } catch (err) {
      console.warn('SSE parse failed', err)
    }
  })
  if (onError) es.addEventListener('error', onError)
  return () => es.close()
}
