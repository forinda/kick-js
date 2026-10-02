/**
 * Metrics — one row per route: calls, error share, and latency percentiles,
 * sortable. The chosen percentile gets an inline bar scaled to the slowest
 * route. Expanding a row shows its latency histogram and outcome split.
 *
 * Polls `/_debug/metrics` every 2s while open. Request totals live on the
 * Overview, so they aren't repeated here.
 */

import { createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from 'solid-js'
import { rpc, type MetricsResponse, type RouteLatency } from '../lib/rpc'
import { store, type RouteEntry } from '../lib/store'
import { openApiRunner } from '../lib/api-runner'
import { durationTone, formatMs, formatPercent, methodColor } from '../lib/format'
import { InfoTip } from '../lib/info'
import { createSort, SortHeader } from '../lib/sort'

const PERCENTILES = ['p50', 'p95', 'p99'] as const
type Percentile = (typeof PERCENTILES)[number]
type Column = 'route' | 'count' | 'errors' | Percentile | 'maxMs'

interface Row extends RouteLatency {
  key: string
  method: string
  path: string
  errorShare: number
}

export const MetricsTab: Component = () => {
  const [data, setData] = createSignal<MetricsResponse | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [search, setSearch] = createSignal('')
  const [pct, setPct] = createSignal<Percentile>('p95')
  const [open, setOpen] = createSignal<string | null>(null)
  const sort = createSort<Column>('p95')

  const refresh = async (): Promise<void> => {
    try {
      setData(await rpc.metrics())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  onMount(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 2000)
    onCleanup(() => clearInterval(timer))
  })

  const rows = createMemo<Row[]>(() => {
    const q = search().trim().toLowerCase()
    const all = Object.entries(data()?.routeLatency ?? {}).map(([key, stats]) => {
      const space = key.indexOf(' ')
      return {
        ...stats,
        key,
        method: key.slice(0, space),
        path: key.slice(space + 1),
        errorShare: stats.count ? stats.serverErrors / stats.count : 0,
      }
    })
    const filtered = q ? all.filter((r) => r.key.toLowerCase().includes(q)) : all
    return sort.apply(filtered, (r, k) =>
      k === 'route' ? r.path : k === 'errors' ? r.errorShare : r[k],
    )
  })
  const slowest = createMemo(() => Math.max(1, ...rows().map((r) => r[pct()])))

  const choosePct = (p: Percentile): void => {
    setPct(p)
    sort.set(p)
  }

  const header = (col: Column, label: string, align: 'left' | 'right' = 'right') => (
    <SortHeader
      label={label}
      align={align}
      active={sort.key() === col}
      desc={sort.desc()}
      onClick={() => sort.toggle(col)}
    />
  )

  return (
    <div class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Filter routes…"
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
          class="w-64 bg-surface-2 border border-border-strong rounded-lg px-3 py-1.5 text-sm text-text-body placeholder:text-text-muted focus:outline-none focus:border-kick-500"
        />
        <div class="flex overflow-hidden rounded-md border border-border-strong text-xs">
          <For each={PERCENTILES}>
            {(p) => (
              <button
                type="button"
                aria-pressed={pct() === p}
                onClick={() => choosePct(p)}
                class={`px-2.5 py-1 font-semibold ${
                  pct() === p
                    ? 'bg-kick-500/20 text-kick-500'
                    : 'bg-surface-2 text-text-secondary hover:text-text-body'
                }`}
              >
                {p}
              </button>
            )}
          </For>
        </div>
        <InfoTip metric={`latency.${pct()}` as never} />
        <span class="flex-1" />
        <span class="text-xs text-text-muted">{rows().length} routes</span>
      </div>

      <Show when={error()}>
        <div class="card text-sm text-red-500">{error()}</div>
      </Show>

      <Show
        when={rows().length > 0}
        fallback={
          <div class="dt-panel-grid">
            <div class="card text-sm text-text-muted">
              {search()
                ? 'No routes match'
                : 'No requests yet — latency appears per route once the app is called.'}
            </div>
          </div>
        }
      >
        <div class="overflow-hidden rounded-xl border border-border bg-surface-1">
          <table class="w-full border-collapse text-[0.8rem]">
            <thead class="border-b border-border text-xs">
              <tr>
                {header('route', 'Route', 'left')}
                {header('count', 'Calls')}
                {header('errors', '5xx')}
                {header('p50', 'p50')}
                {header('p95', 'p95')}
                {header('p99', 'p99')}
                {header('maxMs', 'Max')}
              </tr>
            </thead>
            <tbody>
              <For each={rows()}>
                {(r) => (
                  <>
                    <tr
                      class="cursor-pointer border-b border-dashed border-transparent hover:border-border hover:bg-surface-hover"
                      onClick={() => setOpen((k) => (k === r.key ? null : r.key))}
                    >
                      <td class="px-2 py-1.5">
                        <span class="flex items-center gap-2">
                          <span
                            class={`w-[3.4rem] shrink-0 font-mono text-[0.68rem] font-bold ${methodColor(r.method)}`}
                          >
                            {r.method}
                          </span>
                          <span class="truncate font-mono">{r.path}</span>
                        </span>
                      </td>
                      <td class="px-2 py-1.5 text-right tabular-nums">
                        {r.count.toLocaleString()}
                      </td>
                      <td
                        class={`px-2 py-1.5 text-right tabular-nums ${r.serverErrors ? 'text-red-500' : 'text-text-muted'}`}
                        title={`${r.serverErrors} server errors, ${r.clientErrors} client errors`}
                      >
                        {r.serverErrors ? formatPercent(r.errorShare) : '—'}
                      </td>
                      <For each={PERCENTILES}>
                        {(p) => (
                          <td class="px-2 py-1.5 text-right tabular-nums">
                            <span class="inline-flex items-center justify-end gap-2">
                              <Show when={p === pct()}>
                                <span class="h-1.5 w-16 overflow-hidden rounded-full bg-border/60">
                                  <span
                                    class="block h-full rounded-full bg-kick-500/70"
                                    style={{ width: `${(r[p] / slowest()) * 100}%` }}
                                  />
                                </span>
                              </Show>
                              <span class={`min-w-14 ${durationTone(r[p])}`}>{formatMs(r[p])}</span>
                            </span>
                          </td>
                        )}
                      </For>
                      <td class={`px-2 py-1.5 text-right tabular-nums ${durationTone(r.maxMs)}`}>
                        {formatMs(r.maxMs)}
                      </td>
                    </tr>
                    <Show when={open() === r.key}>
                      <tr class="border-b border-border bg-surface-2/50">
                        <td colspan="7" class="px-4 py-3">
                          <RouteDetail row={r} buckets={data()?.latencyBucketsMs ?? []} />
                        </td>
                      </tr>
                    </Show>
                  </>
                )}
              </For>
            </tbody>
          </table>
        </div>
        <p class="text-[0.66rem] text-text-muted">
          Percentiles cover each route's last 1,000 calls. Durations turn amber above 200 ms, orange
          above 500 ms, red above 1 s.
        </p>
      </Show>
    </div>
  )
}

const RouteDetail: Component<{ row: Row; buckets: number[] }> = (props) => {
  const peak = () => Math.max(1, ...props.row.histogram)
  const label = (i: number): string =>
    i < props.buckets.length
      ? `≤${props.buckets[i]}`
      : `>${props.buckets[props.buckets.length - 1]}`
  const route = (): RouteEntry | undefined =>
    (store.routes() as RouteEntry[]).find(
      (r) => r.method.toUpperCase() === props.row.method && r.path === props.row.path,
    )
  const ok = () => props.row.count - props.row.serverErrors - props.row.clientErrors

  return (
    <div class="flex flex-wrap items-end gap-8">
      <div>
        <div class="mb-1 text-[0.66rem] font-semibold uppercase tracking-wider text-text-muted">
          Latency (ms)
        </div>
        <div class="flex h-16 items-end gap-1">
          <For each={props.row.histogram}>
            {(n, i) => (
              <div
                class="flex w-7 flex-col items-center gap-0.5"
                title={`${n} calls ${label(i())} ms`}
              >
                <div
                  class="w-full rounded-sm bg-kick-500/60"
                  style={{ height: `${Math.max(n ? 2 : 0, (n / peak()) * 48)}px` }}
                />
                <span class="text-[0.58rem] text-text-muted tabular-nums">{label(i())}</span>
              </div>
            )}
          </For>
        </div>
      </div>
      <div class="text-xs">
        <div class="mb-1 text-[0.66rem] font-semibold uppercase tracking-wider text-text-muted">
          Outcomes
        </div>
        <div class="flex gap-2">
          <span class="dt-pill dt-pill-ok">{ok()} ok</span>
          <span class="dt-pill dt-pill-warn">{props.row.clientErrors} 4xx</span>
          <span class="dt-pill dt-pill-err">{props.row.serverErrors} 5xx</span>
        </div>
        <div class="mt-2 text-text-muted">
          min {formatMs(Number.isFinite(props.row.minMs) ? props.row.minMs : 0)} · avg{' '}
          {formatMs(props.row.count ? props.row.totalMs / props.row.count : 0)}
        </div>
      </div>
      <Show when={route()}>
        {(r) => (
          <button
            type="button"
            class="rounded-md border border-kick-500/30 bg-kick-500/20 px-3 py-1 text-xs font-semibold text-kick-500 hover:bg-kick-500/30"
            onClick={() => openApiRunner(r())}
          >
            Try in runner
          </button>
        )}
      </Show>
    </div>
  )
}
