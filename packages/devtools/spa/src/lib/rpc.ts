/**
 * Tiny typed wrapper around `fetch` + `EventSource` for the DevTools
 * RPC surface. Handles the auth-token header convention and centralises
 * the base path resolution (`<body data-base="...">` set by the
 * adapter when serving the dashboard).
 */

import type {
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

/** Resolve the auth token, in order: query param `?token=`, then nothing. */
export function getToken(): string | null {
  return new URLSearchParams(location.search).get('token')
}

function withToken(url: string): string {
  const token = getToken()
  if (!token) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}token=${encodeURIComponent(token)}`
}

/** One-shot GET — throws on non-2xx so callers can rely on the typed return. */
async function get<T>(path: string): Promise<T> {
  const url = withToken(`${getBasePath()}${path}`)
  const res = await fetch(url, { headers: token() })
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`)
  }
  return (await res.json()) as T
}

function token(): Record<string, string> {
  const t = getToken()
  return t ? { 'x-devtools-token': t } : {}
}

export const rpc = {
  runtime: () =>
    get<{ latest: RuntimeSnapshot; history: RuntimeSnapshot[]; health: MemoryHealth }>('/runtime'),
  topology: () => get<TopologySnapshot>('/topology'),
  /** Per-route latency table — separate concept from the route registry below. */
  metrics: () =>
    get<{
      requests: number
      serverErrors: number
      clientErrors: number
      errorRate: number
      uptimeSeconds: number
      startedAt: string
      routeLatency: Record<
        string,
        {
          count: number
          totalMs: number
          minMs: number
          maxMs: number
          p50: number
          p95: number
          p99: number
        }
      >
    }>('/metrics'),
  /** Backwards-compatible alias for `metrics()` — pre-existing callers. */
  routes: () =>
    get<{
      requests: number
      serverErrors: number
      clientErrors: number
      errorRate: number
      uptimeSeconds: number
      startedAt: string
      routeLatency: Record<
        string,
        {
          count: number
          totalMs: number
          minMs: number
          maxMs: number
          p50: number
          p95: number
          p99: number
        }
      >
    }>('/metrics'),
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
        firstResolved?: number
        lastResolved?: number
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
      namespaces?: Record<string, { connections: number; handlers: number }>
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
  es.onmessage = (event) => {
    try {
      onMessage(JSON.parse(event.data) as T)
    } catch (err) {
      console.warn('SSE parse failed', err)
    }
  }
  if (onError) es.onerror = onError
  return () => es.close()
}
