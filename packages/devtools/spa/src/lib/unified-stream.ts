/**
 * Unified `/stream` SSE consumer + initial-snapshot loader.
 *
 * Mirrors the legacy Vue dashboard's connect() flow: one SSE
 * subscription delivers metrics ticks + container-change pings, with
 * a polling fallback when SSE isn't available. On every container
 * change we re-fetch the registries (routes / container / queues / ws)
 * so the per-tab UIs stay fresh without each owning their own watcher.
 *
 * Tabs subscribe to {@link store} for slices and never touch the
 * network themselves — keeps connection bookkeeping in one place.
 */

import { rpc, subscribe, AuthRequiredError } from './rpc'
import { store, storeActions } from './store'

let _disposed = false
let _pollTimer: ReturnType<typeof setInterval> | null = null
let _unsubscribe: (() => void) | null = null

interface MetricsEvent {
  type: 'metrics'
  requestCount: number
  errorCount: number
  clientErrorCount: number
  errorRate: number
  uptimeSeconds: number
}

interface ContainerEvent {
  type: 'container'
  changes?: unknown
  timestamp?: number
}

type StreamEvent = MetricsEvent | ContainerEvent

/**
 * Bootstrap the stream — fetches the initial snapshot of every
 * registry, then subscribes to /stream. Call once at App mount.
 * Returns a teardown function for use in onCleanup.
 */
export async function startUnifiedStream(): Promise<() => void> {
  storeActions.setConnectionStatus('connecting')

  // Initial snapshot — sequenced so tabs don't render half-loaded UIs.
  await refetchSnapshots()

  // Subscribe to /stream for live ticks. The `subscribe` helper closes
  // the EventSource on dispose; we wrap it in our own cleanup that
  // also tears down the polling fallback timer if active.
  _unsubscribe = subscribe<StreamEvent>(
    '/stream',
    (data) => {
      if (_disposed) return
      storeActions.setConnectionStatus('live')
      stopPolling()
      if (data.type === 'metrics') {
        applyMetricsEvent(data)
        storeActions.touch()
        return
      }
      if (data.type === 'container') {
        // Container changed — registry/routes/queues may have shifted.
        // Refetch in the background; don't block the SSE handler.
        void refetchSnapshots()
        return
      }
    },
    () => {
      if (_disposed) return
      // SSE dropped — fall back to polling.
      storeActions.setConnectionStatus('polling')
      startPolling()
    },
  )

  return dispose
}

/**
 * Re-fetch every registry endpoint in parallel. Called on initial
 * mount + after each `container` SSE event so tabs always see fresh
 * counts and listings. Failures (endpoint returning 404 because the
 * adapter isn't mounted) leave the previous slice in place.
 */
async function refetchSnapshots(): Promise<void> {
  const results = await Promise.allSettled([
    rpc.health(),
    rpc.metrics(),
    rpc.routeRegistry(),
    rpc.container(),
    rpc.queues(),
    rpc.ws(),
  ])
  // If every fetch came back AUTH_REQUIRED, raise the auth gate so
  // the user can paste a token. Per-endpoint 403 (e.g. devtools
  // gates only /container) shouldn't trip the global gate; the
  // 'every fetch failed with auth' check is the right signal.
  const allAuth = results.every(
    (r) => r.status === 'rejected' && r.reason instanceof AuthRequiredError,
  )
  if (allAuth) {
    storeActions.setAuthRequired(true)
    storeActions.setConnectionStatus('disconnected')
    return
  }
  // Lower the gate as soon as any endpoint succeeds — covers the
  // case where the user just pasted a valid token via the modal.
  if (store.authRequired()) {
    storeActions.setAuthRequired(false)
    storeActions.setAuthError(null)
  }
  const [health, metrics, routes, container, queues, ws] = results
  if (health.status === 'fulfilled') {
    storeActions.setHealth({
      status: health.value.status,
      errorRate: health.value.errorRate,
      uptime: health.value.uptime,
      adapters: health.value.adapters ?? {},
    })
  }
  if (metrics.status === 'fulfilled') {
    storeActions.setMetrics({
      requests: metrics.value.requests,
      serverErrors: metrics.value.serverErrors,
      clientErrors: metrics.value.clientErrors,
      errorRate: metrics.value.errorRate,
      uptimeSeconds: metrics.value.uptimeSeconds,
      startedAt: metrics.value.startedAt,
    })
  }
  if (routes.status === 'fulfilled') {
    storeActions.setRoutes(routes.value.routes ?? [])
  }
  if (container.status === 'fulfilled') {
    storeActions.setContainer(container.value.registrations ?? [])
  }
  if (queues.status === 'fulfilled') {
    storeActions.setQueues({
      enabled: queues.value.enabled,
      queues: queues.value.queues ?? [],
    })
  }
  if (ws.status === 'fulfilled') {
    storeActions.setWs(ws.value)
  }
  storeActions.touch()
}

function applyMetricsEvent(data: MetricsEvent): void {
  const current = store.metrics()
  if (!current) return
  storeActions.setMetrics({
    ...current,
    requests: data.requestCount,
    serverErrors: data.errorCount,
    clientErrors: data.clientErrorCount,
    errorRate: data.errorRate,
    uptimeSeconds: data.uptimeSeconds,
  })
  const health = store.health()
  if (health) {
    storeActions.setHealth({
      ...health,
      uptime: data.uptimeSeconds,
      errorRate: data.errorRate,
    })
  }
}

function startPolling(): void {
  if (_pollTimer) return
  _pollTimer = setInterval(() => {
    if (_disposed) return
    void refetchSnapshots()
  }, 5000)
}

function stopPolling(): void {
  if (_pollTimer) {
    clearInterval(_pollTimer)
    _pollTimer = null
  }
}

function dispose(): void {
  _disposed = true
  stopPolling()
  if (_unsubscribe) {
    _unsubscribe()
    _unsubscribe = null
  }
  storeActions.setConnectionStatus('disconnected')
}
