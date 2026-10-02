/**
 * Overview — the landing tab. A strip of headline numbers with the last
 * minute as sparklines, the app's recent failures, and its status:
 * uptime, adapters, WebSocket.
 *
 * Counts come from the shared store; the sparklines from the traffic
 * sampler; latency and failures from `/_debug/requests` (polled while
 * open); heap from `/_debug/runtime` when the sampler runs.
 */

import { createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from 'solid-js'
import { store } from '../lib/store'
import { rpc, type RequestLogEntry } from '../lib/rpc'
import { requestCounts, serverErrorCounts } from '../lib/traffic'
import { deltas, percentile } from '../lib/stats'
import { Sparkline } from '../lib/sparkline'
import {
  formatBytes,
  formatMs,
  formatPercent,
  formatUptime,
  methodColor,
  statusPill,
} from '../lib/format'
import { InfoTip } from '../lib/info'
import { switchTab } from '../lib/nav'
import { openRequest } from './RequestsTab'

const POLL_MS = 2000
/** Requests the latency figure and failure list are taken from. */
const RECENT = 200

export const OverviewTab: Component = () => {
  const [recent, setRecent] = createSignal<RequestLogEntry[]>([])
  const [heap, setHeap] = createSignal<number[] | null>(null)
  let lastSeq = 0
  let polling = false

  const poll = async (): Promise<void> => {
    if (polling) return // a slow response must not let two polls append the same entries
    polling = true
    try {
      const [reqs, runtime] = await Promise.allSettled([rpc.requests(lastSeq), rpc.runtime()])
      if (reqs.status === 'fulfilled') {
        // The app restarted and its log began again — start over from its first entry.
        if (reqs.value.latest < lastSeq) {
          lastSeq = 0
          setRecent([])
          return // the next poll fetches from the start
        }
        const fresh = reqs.value.requests
        if (fresh.length) {
          lastSeq = fresh[fresh.length - 1]!.seq
          setRecent((prev) => [...prev, ...fresh].slice(-RECENT))
        }
      }
      // The runtime sampler can be turned off (404) — then there's no heap tile.
      setHeap(
        runtime.status === 'fulfilled' ? runtime.value.history.map((s) => s.memory.heapUsed) : null,
      )
    } finally {
      polling = false
    }
  }
  onMount(() => {
    void poll()
    const timer = setInterval(() => void poll(), POLL_MS)
    onCleanup(() => clearInterval(timer))
  })

  const p95 = createMemo(() =>
    percentile(
      recent().map((r) => r.durationMs),
      95,
    ),
  )
  const failures = createMemo(() =>
    recent()
      .filter((r) => r.status >= 500 || r.error)
      .toReversed()
      .slice(0, 6),
  )

  return (
    <div class="flex flex-col gap-4">
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Requests"
          value={store.metrics()?.requests.toLocaleString() ?? '—'}
          hint={`${sum(deltas(requestCounts()))} in the last minute`}
          series={deltas(requestCounts())}
        />
        <Tile
          label="Server errors"
          value={store.metrics()?.serverErrors.toLocaleString() ?? '—'}
          hint={
            <>
              {formatPercent(store.metrics()?.errorRate ?? 0)} error rate
              <InfoTip metric="error-rate" />
            </>
          }
          series={deltas(serverErrorCounts())}
          stroke="#ef4444"
          tone={store.metrics()?.serverErrors ? 'err' : undefined}
        />
        <Tile
          label="Latency p95"
          value={p95() === undefined ? '—' : formatMs(p95()!)}
          hint={`over the last ${recent().length} requests`}
          series={recent()
            .slice(-60)
            .map((r) => r.durationMs)}
        />
        <Show
          when={heap()}
          fallback={
            <Tile
              label="Uptime"
              value={store.health() ? formatUptime(store.health()!.uptime) : '—'}
              hint="runtime sampler is off"
            />
          }
        >
          {(h) => (
            <Tile
              label="Heap used"
              value={h().length ? formatBytes(h()[h().length - 1]!) : '—'}
              hint="sampled every second"
              series={h()}
            />
          )}
        </Show>
      </div>

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <section class="rounded-xl border border-border bg-surface-1">
          <header class="flex items-center justify-between border-b border-border px-4 py-2.5">
            <h2 class="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Recent failures
            </h2>
            <button
              type="button"
              class="text-xs text-text-muted hover:text-text-strong"
              onClick={() => switchTab('requests')}
            >
              All requests →
            </button>
          </header>
          <Show
            when={failures().length > 0}
            fallback={
              <div class="flex flex-col items-center gap-2 px-4 py-8 text-sm text-text-muted">
                <Show
                  when={recent().length > 0}
                  fallback={
                    <>
                      No requests yet.
                      <button
                        type="button"
                        class="rounded-md border border-kick-500/30 bg-kick-500/20 px-3 py-1 text-xs font-semibold text-kick-500 hover:bg-kick-500/30"
                        onClick={() => switchTab('routes')}
                      >
                        Try a route
                      </button>
                    </>
                  }
                >
                  No failures in the last {recent().length} requests.
                </Show>
              </div>
            }
          >
            <For each={failures()}>
              {(r) => (
                <button
                  type="button"
                  class="flex w-full cursor-pointer items-center gap-2 border-0 border-b border-border/50 bg-transparent px-4 py-1.5 text-left text-[0.78rem] text-text-body last:border-b-0 hover:bg-surface-hover"
                  onClick={() => openRequest(r.seq)}
                >
                  <span class={`${statusPill(r.status)} w-10 shrink-0 text-center`}>
                    {r.status}
                  </span>
                  <span
                    class={`w-[3.4rem] shrink-0 font-mono text-[0.68rem] font-bold ${methodColor(r.method)}`}
                  >
                    {r.method}
                  </span>
                  <span class="min-w-0 shrink truncate font-mono">{r.path}</span>
                  <span class="min-w-0 flex-1 truncate text-xs text-red-500">
                    {r.error ? `${r.error.name}: ${r.error.message}` : ''}
                  </span>
                  <span class="shrink-0 text-[0.66rem] text-text-muted tabular-nums">
                    {new Date(r.at).toLocaleTimeString([], { hour12: false })}
                  </span>
                </button>
              )}
            </For>
          </Show>
        </section>

        <section class="rounded-xl border border-border bg-surface-1 px-4 py-3 text-[0.8rem]">
          <h2 class="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">App</h2>
          <Show when={store.health()} fallback={<p class="italic text-text-muted">Loading…</p>}>
            {(h) => (
              <>
                <Line label="Status">
                  <span class={`badge ${badgeForStatus(h().status)}`}>{h().status}</span>
                </Line>
                <Line label="Uptime">{formatUptime(h().uptime)}</Line>
                <Show when={store.metrics()}>
                  {(m) => (
                    <Line label="Started">{new Date(m().startedAt).toLocaleTimeString()}</Line>
                  )}
                </Show>
                <Show when={store.ws().enabled}>
                  <Line label="WebSocket">
                    {store.ws().activeConnections ?? 0} open ·{' '}
                    {(store.ws().messagesReceived ?? 0) + (store.ws().messagesSent ?? 0)} msgs
                  </Line>
                </Show>
                <Show when={Object.keys(h().adapters).length > 0}>
                  <h3 class="mt-3 mb-1 text-[0.66rem] font-semibold uppercase tracking-wider text-text-muted">
                    Adapters
                  </h3>
                  <For each={Object.entries(h().adapters)}>
                    {([name, status]) => (
                      <div class="flex items-center gap-2 py-0.5" title={status}>
                        <span
                          class={`h-2 w-2 shrink-0 rounded-full ${
                            status === 'running' ? 'bg-emerald-500' : 'bg-amber-500'
                          }`}
                          aria-hidden="true"
                        />
                        <span class="min-w-0 flex-1 truncate text-text-secondary">{name}</span>
                        <Show when={status !== 'running'}>
                          <span class="text-xs text-amber-500">{status}</span>
                        </Show>
                      </div>
                    )}
                  </For>
                </Show>
              </>
            )}
          </Show>
        </section>
      </div>
    </div>
  )
}

const Tile: Component<{
  label: string
  value: string
  hint?: unknown
  series?: readonly number[]
  stroke?: string
  tone?: 'err'
}> = (props) => (
  <div class="flex flex-col rounded-xl border border-border bg-surface-1 px-4 pt-3 pb-2">
    <span class="text-[0.66rem] font-semibold uppercase tracking-wider text-text-muted">
      {props.label}
    </span>
    <span
      class={`mt-0.5 text-xl font-semibold tabular-nums ${
        props.tone === 'err' ? 'text-red-500' : 'text-text-strong'
      }`}
    >
      {props.value}
    </span>
    <span class="text-xs text-text-muted">{props.hint as Element}</span>
    <div class="mt-1 h-8 [&_svg]:block [&_svg]:h-full [&_svg]:w-full">
      <Show when={(props.series?.length ?? 0) > 1}>
        <Sparkline values={props.series!} stroke={props.stroke} />
      </Show>
    </div>
  </div>
)

const Line: Component<{ label: string; children: unknown }> = (props) => (
  <div class="flex items-center justify-between py-0.5">
    <span class="text-text-secondary">{props.label}</span>
    <span class="font-medium tabular-nums">{props.children as Element}</span>
  </div>
)

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0)

function badgeForStatus(status: string): string {
  if (status === 'healthy') return 'badge-ok'
  if (status === 'degraded') return 'badge-warn'
  return 'badge-critical'
}
