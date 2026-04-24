/**
 * Overview tab — at-a-glance triple-card (Health / Metrics / WS)
 * dashboard. The first thing a user sees on a fresh visit; pulls
 * everything from the shared store so it doesn't own any network.
 *
 * Mirrors the legacy Vue dashboard's Overview tab with collapsibles
 * for the noisier sub-sections (adapter statuses, WS namespaces).
 */

import { createSignal, For, Show, type Component } from 'solid-js'
import { store } from '../lib/store'
import { formatPercent, formatUptime } from '../lib/format'
import { InfoTip } from '../lib/info'

export const OverviewTab: Component = () => {
  return (
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <HealthCard />
      <MetricsCard />
      <WsCard />
    </div>
  )
}

const HealthCard: Component = () => {
  const [adaptersOpen, setAdaptersOpen] = createSignal(false)
  return (
    <div class="bg-slate-900 rounded-xl border border-slate-800 p-5">
      <h2 class="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Health</h2>
      <Show when={store.health()} fallback={<p class="text-slate-600 italic">Loading…</p>}>
        {(h) => (
          <>
            <Row label="Status">
              <span class={`badge ${badgeForStatus(h().status)}`}>{h().status}</span>
            </Row>
            <Row label="Uptime">
              <span class="font-semibold tabular-nums">{formatUptime(h().uptime)}</span>
            </Row>
            <Row label="Error rate">
              <span class="font-semibold tabular-nums">
                {formatPercent(h().errorRate)}
                <InfoTip metric="error-rate" />
              </span>
            </Row>
            <Show when={Object.keys(h().adapters).length > 0}>
              <div class="border-t border-slate-800 mt-2 pt-2">
                <button
                  type="button"
                  class="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1"
                  onClick={() => setAdaptersOpen((v) => !v)}
                >
                  <svg
                    class={`w-3 h-3 transition-transform ${adaptersOpen() ? 'rotate-90' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                  Adapters ({Object.keys(h().adapters).length})
                </button>
                <Show when={adaptersOpen()}>
                  <div class="mt-1">
                    <For each={Object.entries(h().adapters)}>
                      {([name, status]) => (
                        <div class="flex items-center justify-between py-1">
                          <span class="text-slate-400 text-sm">{name}</span>
                          <span class={`badge ${status === 'running' ? 'badge-ok' : 'badge-warn'}`}>
                            {status}
                          </span>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </Show>
          </>
        )}
      </Show>
    </div>
  )
}

const MetricsCard: Component = () => {
  return (
    <div class="bg-slate-900 rounded-xl border border-slate-800 p-5">
      <h2 class="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Metrics</h2>
      <Show when={store.metrics()} fallback={<p class="text-slate-600 italic">Loading…</p>}>
        {(m) => (
          <>
            <Row label="Total requests">
              <span class="font-semibold tabular-nums">{m().requests.toLocaleString()}</span>
            </Row>
            <Row label="5xx errors">
              <span class="font-semibold tabular-nums text-red-400">{m().serverErrors}</span>
            </Row>
            <Row label="4xx errors">
              <span class="font-semibold tabular-nums text-amber-400">{m().clientErrors}</span>
            </Row>
            <Row label="Started">
              <span class="font-semibold text-sm">
                {new Date(m().startedAt).toLocaleTimeString()}
              </span>
            </Row>
          </>
        )}
      </Show>
    </div>
  )
}

const WsCard: Component = () => {
  const [nsOpen, setNsOpen] = createSignal(false)
  return (
    <div class="bg-slate-900 rounded-xl border border-slate-800 p-5">
      <h2 class="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">WebSocket</h2>
      <Show
        when={store.ws().enabled}
        fallback={<p class="text-slate-600 italic">No WsAdapter detected</p>}
      >
        <Row label="Active">
          <span class="font-semibold tabular-nums text-emerald-400">
            {store.ws().activeConnections ?? 0}
          </span>
        </Row>
        <Row label="Total">
          <span class="font-semibold tabular-nums">{store.ws().totalConnections ?? 0}</span>
        </Row>
        <Row label="Messages in">
          <span class="font-semibold tabular-nums">{store.ws().messagesReceived ?? 0}</span>
        </Row>
        <Row label="Messages out">
          <span class="font-semibold tabular-nums">{store.ws().messagesSent ?? 0}</span>
        </Row>
        <Show when={store.ws().namespaces && Object.keys(store.ws().namespaces ?? {}).length > 0}>
          <div class="border-t border-slate-800 mt-2 pt-2">
            <button
              type="button"
              class="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1"
              onClick={() => setNsOpen((v) => !v)}
            >
              <svg
                class={`w-3 h-3 transition-transform ${nsOpen() ? 'rotate-90' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 5l7 7-7 7"
                />
              </svg>
              Namespaces ({Object.keys(store.ws().namespaces ?? {}).length})
            </button>
            <Show when={nsOpen()}>
              <div class="mt-1">
                <For each={Object.entries(store.ws().namespaces ?? {})}>
                  {([name, ns]) => (
                    <div class="flex items-center justify-between py-1">
                      <span class="text-slate-400 text-sm font-mono">{name}</span>
                      <span class="text-sm">
                        {ns.connections} conn / {ns.handlers} handlers
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>
      </Show>
    </div>
  )
}

const Row: Component<{ label: string; children: unknown }> = (props) => (
  <div class="flex items-center justify-between mb-2">
    <span class="text-slate-400">{props.label}</span>
    {props.children as unknown as Element}
  </div>
)

function badgeForStatus(status: string): string {
  if (status === 'healthy') return 'badge-ok'
  if (status === 'degraded') return 'badge-warn'
  return 'badge-critical'
}
