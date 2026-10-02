/**
 * Requests — the app's recent requests, newest first, with the selected one's
 * details beside them. Polls `/_debug/requests?since=<seq>` while open; a
 * request whose route is known can be replayed in the API runner.
 */

import { createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from 'solid-js'
import { rpc, type RequestLogEntry } from '../lib/rpc'
import { store, type RouteEntry } from '../lib/store'
import { openApiRunner } from '../lib/api-runner'
import { paramsFromPath } from '../lib/api-runner-core'
import { formatMs, methodColor, statusPill } from '../lib/format'
import { SplitPane } from '../lib/split-pane'
import { switchTab } from '../lib/nav'

const POLL_MS = 1500
/** Matches the server's default log size, with room for a bigger one. */
const KEEP = 500

const STATUSES = ['ALL', '2xx', '3xx', '4xx', '5xx'] as const
type StatusFilter = (typeof STATUSES)[number]

/** A request to select when the tab next opens — set from the Overview. */
let focusOnOpen: number | null = null

/** Show the Requests tab with one request selected. */
export function openRequest(seq: number): void {
  focusOnOpen = seq
  switchTab('requests')
}

const time = (at: number): string => new Date(at).toLocaleTimeString([], { hour12: false })

export const RequestsTab: Component = () => {
  const [entries, setEntries] = createSignal<RequestLogEntry[]>([])
  const [selected, setSelected] = createSignal<number | null>(focusOnOpen)
  focusOnOpen = null
  const [search, setSearch] = createSignal('')
  const [status, setStatus] = createSignal<StatusFilter>('ALL')
  const [paused, setPaused] = createSignal(false)
  let lastSeq = 0
  let polling = false

  const poll = async (): Promise<void> => {
    if (paused() || polling) return // overlapping polls would add the same entries twice
    polling = true
    try {
      const { requests, latest } = await rpc.requests(lastSeq)
      // The app restarted and its log began again — start over from its first entry.
      if (latest < lastSeq) {
        lastSeq = 0
        setEntries([])
        setSelected(null)
        return // the next poll fetches from the start
      }
      if (requests.length === 0) return
      lastSeq = requests[requests.length - 1]!.seq
      setEntries((prev) => [...requests.toReversed(), ...prev].slice(0, KEEP))
    } catch {
      // The connection banner covers an unreachable app.
    } finally {
      polling = false
    }
  }
  onMount(() => {
    void poll()
    const timer = setInterval(() => void poll(), POLL_MS)
    onCleanup(() => clearInterval(timer))
  })

  const filtered = createMemo(() => {
    const q = search().trim().toLowerCase()
    const s = status()
    return entries().filter(
      (e) =>
        (s === 'ALL' || Math.floor(e.status / 100) === Number(s[0])) &&
        (!q || `${e.method} ${e.path}`.toLowerCase().includes(q)),
    )
  })
  const current = createMemo(() => entries().find((e) => e.seq === selected()) ?? null)

  /** The registered route a request matched, for replaying it. */
  const routeOf = (e: RequestLogEntry): RouteEntry | undefined =>
    e.route === undefined
      ? undefined
      : (store.routes() as RouteEntry[]).find(
          (r) => r.method.toUpperCase() === e.method.toUpperCase() && r.path === e.route,
        )

  const chip = (active: boolean): string =>
    `px-2 py-0.5 text-[0.68rem] font-semibold rounded-md border ${
      active
        ? 'bg-kick-500/20 text-kick-500 border-kick-500/30'
        : 'bg-surface-2 text-text-secondary border-border-strong hover:text-text-body'
    }`

  const list = (
    <>
      <div class="flex flex-col gap-1.5 border-b border-border p-2">
        <input
          type="text"
          placeholder="Search method or path…"
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
          class="w-full bg-surface-2 border border-border-strong rounded-lg px-3 py-1.5 text-sm text-text-body placeholder:text-text-muted focus:outline-none focus:border-kick-500"
        />
        <div class="flex items-center gap-1 flex-wrap">
          <For each={STATUSES}>
            {(s) => (
              <button
                type="button"
                onClick={() => setStatus(s)}
                aria-pressed={status() === s}
                class={chip(status() === s)}
              >
                {s}
              </button>
            )}
          </For>
          <span class="flex-1" />
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-pressed={paused()}
            class={chip(paused())}
          >
            {paused() ? 'Paused' : 'Pause'}
          </button>
          <button
            type="button"
            onClick={() => {
              setEntries([])
              setSelected(null)
            }}
            class={chip(false)}
          >
            Clear
          </button>
        </div>
        <div class="text-xs text-text-muted">
          <Show when={search() || status() !== 'ALL'}>{filtered().length} matched · </Show>
          {entries().length} requests
        </div>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <Show
          when={filtered().length > 0}
          fallback={
            <div class="empty">
              {entries().length ? 'No requests match' : 'No requests yet — call the app'}
            </div>
          }
        >
          <For each={filtered()}>
            {(e) => (
              <button
                type="button"
                class={`flex w-full cursor-pointer items-center gap-2 border-0 border-b border-border/50 px-2.5 py-1 text-left text-[0.78rem] text-text-body ${
                  selected() === e.seq
                    ? 'bg-accent/12 shadow-[inset_2px_0_0_0_var(--color-accent)]'
                    : 'bg-transparent hover:bg-surface-hover'
                }`}
                onClick={() => setSelected(e.seq)}
              >
                <span class={`${statusPill(e.status)} w-10 shrink-0 text-center`}>{e.status}</span>
                <span
                  class={`w-[3.4rem] shrink-0 font-mono text-[0.68rem] font-bold ${methodColor(e.method)}`}
                >
                  {e.method}
                </span>
                <span class="min-w-0 flex-1 truncate font-mono">{e.path}</span>
                <Show when={e.error}>
                  <span class="text-red-500 text-[0.66rem]" title={e.error!.message}>
                    ●
                  </span>
                </Show>
                <span class="shrink-0 text-[0.7rem] text-text-muted tabular-nums">
                  {formatMs(e.durationMs)}
                </span>
                <span class="w-14 shrink-0 text-right text-[0.66rem] text-text-muted tabular-nums">
                  {time(e.at)}
                </span>
              </button>
            )}
          </For>
        </Show>
      </div>
    </>
  )

  const detail = (
    <Show
      when={current()}
      fallback={
        <div class="dt-panel-grid">
          <div class="card text-sm text-text-muted">Select a request to see its details</div>
        </div>
      }
    >
      {(e) => (
        <section class="flex h-full min-h-0 flex-col gap-3 overflow-y-auto bg-surface-1 p-4">
          <div class="flex items-center gap-2">
            <span class={statusPill(e().status)}>{e().status}</span>
            <span class={`font-mono text-sm font-bold ${methodColor(e().method)}`}>
              {e().method}
            </span>
            <span class="min-w-0 truncate font-mono text-sm text-text-strong">{e().path}</span>
          </div>
          <Show when={e().error}>
            {(err) => (
              <div class="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm">
                <span class="font-semibold text-red-500">{err().name}</span>
                <span class="text-text-body">: {err().message}</span>
              </div>
            )}
          </Show>
          <dl class="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-[0.8rem]">
            <dt class="text-text-muted">Route</dt>
            <dd class="m-0 font-mono">{e().route ?? 'no route matched'}</dd>
            <dt class="text-text-muted">Duration</dt>
            <dd class="m-0">{formatMs(e().durationMs)}</dd>
            <dt class="text-text-muted">Time</dt>
            <dd class="m-0">{new Date(e().at).toLocaleString()}</dd>
            <dt class="text-text-muted">Request ID</dt>
            <dd class="m-0 font-mono break-all">{e().requestId ?? '—'}</dd>
          </dl>
          <Show when={routeOf(e())}>
            {(route) => (
              <div>
                <button
                  type="button"
                  class="rounded-md border border-kick-500/30 bg-kick-500/20 px-3 py-1 text-xs font-semibold text-kick-500 hover:bg-kick-500/30"
                  onClick={() => openApiRunner(route(), paramsFromPath(route().path, e().path))}
                >
                  Replay in runner
                </button>
                <p class="mt-1.5 text-xs text-text-muted">
                  Opens the route with these path params. Query, headers and body aren't logged —
                  the runner keeps the ones saved for this route.
                </p>
              </div>
            )}
          </Show>
        </section>
      )}
    </Show>
  )

  return <SplitPane storageKey="requests" left={list} right={detail} />
}
