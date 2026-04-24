/**
 * Shared reactive store for the devtools SPA.
 *
 * Each tab subscribes to whichever slice it needs without owning its
 * own polling loop or SSE subscription. The unified stream
 * (`./unified-stream.ts`) writes here; tabs read.
 *
 * Solid signals only — no atoms, no third-party state lib. Cheap to
 * import, cheap to subscribe to, no setup cost.
 */

import { createSignal } from 'solid-js'

export type ConnectionStatus = 'connecting' | 'live' | 'polling' | 'disconnected'

export interface HealthSnapshot {
  status: 'healthy' | 'degraded' | 'unknown'
  errorRate: number
  uptime: number
  adapters: Record<string, string>
}

export interface MetricsSnapshot {
  requests: number
  serverErrors: number
  clientErrors: number
  errorRate: number
  uptimeSeconds: number
  startedAt: string
}

export interface RouteEntry {
  method: string
  path: string
  controller: string
  handler: string
  middleware: string[]
}

export interface ContainerRegistration {
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
}

export interface QueueStats {
  name: string
  waiting?: number
  active?: number
  completed?: number
  failed?: number
  delayed?: number
  paused?: number
  error?: string
}

export interface WsStats {
  enabled: boolean
  activeConnections?: number
  totalConnections?: number
  messagesReceived?: number
  messagesSent?: number
  namespaces?: Record<string, { connections: number; handlers: number }>
}

const [connectionStatus, setConnectionStatus] = createSignal<ConnectionStatus>('connecting')
const [lastUpdate, setLastUpdate] = createSignal<Date | null>(null)
const [health, setHealth] = createSignal<HealthSnapshot | null>(null)
const [metrics, setMetrics] = createSignal<MetricsSnapshot | null>(null)
const [routes, setRoutes] = createSignal<RouteEntry[]>([])
const [container, setContainer] = createSignal<ContainerRegistration[]>([])
const [queues, setQueues] = createSignal<{ enabled: boolean; queues: QueueStats[] }>({
  enabled: false,
  queues: [],
})
const [ws, setWs] = createSignal<WsStats>({ enabled: false })

export const store = {
  connectionStatus,
  lastUpdate,
  health,
  metrics,
  routes,
  container,
  queues,
  ws,
}

export const storeActions = {
  setConnectionStatus,
  setLastUpdate,
  setHealth,
  setMetrics,
  setRoutes,
  setContainer,
  setQueues,
  setWs,
  /** Mark "we just received fresh data from the server". */
  touch(): void {
    setLastUpdate(new Date())
  },
}
