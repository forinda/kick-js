/**
 * Runtime — the Node process: identity and uptime in a header strip, memory,
 * event loop and CPU as charts over the last minute, and memory health (heap
 * growth, GC reclaim, open handles) with the heap-snapshot and force-GC
 * actions.
 *
 * Bootstraps from `/_debug/runtime`, then follows `/_debug/memory/stream`
 * (one sample per second, with the memory health computed server-side).
 */

import { createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from 'solid-js'
import type { MemoryHealth, RuntimeSnapshot } from '@forinda/kickjs-devtools-kit'
import { Chart } from '../lib/chart'
import { post, rpc, subscribe, type ProcessInfo } from '../lib/rpc'
import { formatBytes, formatMs, formatPercent, formatUptime, severityTone } from '../lib/format'
import { InfoTip } from '../lib/info'

const HISTORY = 60

export const RuntimeTab: Component = () => {
  const [history, setHistory] = createSignal<RuntimeSnapshot[]>([])
  const [health, setHealth] = createSignal<MemoryHealth | null>(null)
  const [proc, setProc] = createSignal<ProcessInfo | null>(null)
  const [unavailable, setUnavailable] = createSignal(false)

  const ingest = (snaps: RuntimeSnapshot[]): void => {
    setHistory((prev) => [...prev, ...snaps].slice(-HISTORY))
  }

  onMount(() => {
    rpc
      .runtime()
      .then((data) => {
        setProc(data.process ?? null)
        setHealth(data.health)
        ingest(data.history)
      })
      // 404: the app turned the runtime sampler off.
      .catch(() => setUnavailable(true))
    const unsubscribe = subscribe<{ snapshot: RuntimeSnapshot; health: MemoryHealth }>(
      '/memory/stream',
      (event) => {
        ingest([event.snapshot])
        setHealth(event.health)
      },
      () => {},
    )
    onCleanup(unsubscribe)
  })

  const latest = createMemo(() => history()[history().length - 1])
  const series = (pick: (s: RuntimeSnapshot) => number) => history().map(pick)
  /** CPU time per wall-clock time between samples, as a percentage of one core. */
  const cpu = createMemo(() =>
    history().map((s, i, all) => {
      const elapsedMs = i ? s.timestamp - all[i - 1]!.timestamp : 1000
      return ((s.cpu.userMicros + s.cpu.systemMicros) / 1000 / Math.max(1, elapsedMs)) * 100
    }),
  )
  /** Samples where a garbage collection ran. */
  const gcMarks = createMemo(() =>
    history().flatMap((s, i, all) => (i && s.gc.count > all[i - 1]!.gc.count ? [i] : [])),
  )

  return (
    <Show
      when={!unavailable()}
      fallback={
        <div class="dt-panel-grid">
          <div class="card max-w-md text-sm text-text-secondary">
            The runtime sampler is off. Remove <code>runtime: {'{ enabled: false }'}</code> from{' '}
            <code>DevToolsAdapter(...)</code> to see process metrics here.
          </div>
        </div>
      }
    >
      <div class="flex flex-col gap-4">
        <header class="flex flex-wrap items-center gap-2 text-xs">
          <Show when={proc()}>
            {(p) => (
              <>
                <Show when={p().runtime}>
                  {(rt) => <span class="dt-tone dt-tone-blue">{rt().name}</span>}
                </Show>
                <span class="dt-tone dt-tone-gray">Node {p().nodeVersion}</span>
                <span class="dt-tone dt-tone-gray">
                  {p().platform}/{p().arch}
                </span>
                <span class="dt-tone dt-tone-gray">pid {p().pid}</span>
              </>
            )}
          </Show>
          <Show when={latest()}>
            {(s) => (
              <span class="text-text-muted">
                up {formatUptime(s().uptimeSec)} · {s().gc.count} GCs,{' '}
                {formatMs(s().gc.totalPauseMs)} paused
              </span>
            )}
          </Show>
          <span class="flex-1" />
          <SnapshotButton />
          <GcButton />
        </header>

        <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Chart
            title="Heap"
            info={<InfoTip metric="heap.used" />}
            format={formatBytes}
            series={[
              { label: 'used', values: series((s) => s.memory.heapUsed) },
              { label: 'total', values: series((s) => s.memory.heapTotal) },
            ]}
          />
          <Chart
            title="Process memory"
            info={<InfoTip metric="rss" />}
            format={formatBytes}
            series={[
              { label: 'RSS', values: series((s) => s.memory.rss) },
              { label: 'external', values: series((s) => s.memory.external) },
            ]}
          />
          <Chart
            title="Event loop delay"
            info={<InfoTip metric="event-loop.p99" />}
            format={formatMs}
            marks={gcMarks()}
            series={[
              { label: 'p99', values: series((s) => s.eventLoop.p99) },
              { label: 'p50', values: series((s) => s.eventLoop.p50) },
            ]}
          />
          <Chart
            title="CPU"
            format={(v) => `${v.toFixed(v < 10 ? 1 : 0)}%`}
            max={Math.max(100, ...cpu())}
            series={[{ label: 'CPU', values: cpu() }]}
          />
        </div>
        <p class="-mt-2 text-[0.66rem] text-text-muted">
          Ticks under the event-loop chart mark garbage collections. CPU is a percentage of one
          core.
        </p>

        <Show when={health()}>
          {(h) => (
            <section class="rounded-xl border border-border bg-surface-1 px-4 py-3">
              <header class="mb-2 flex items-center gap-2">
                <h3 class="text-[0.66rem] font-semibold uppercase tracking-wider text-text-muted">
                  Memory health
                </h3>
                <InfoTip metric="leak.risk" />
                <span
                  class={
                    h().sampling
                      ? severityTone('idle')
                      : severityTone(
                          h().heapGrowthSeverity === 'ok'
                            ? 'ok'
                            : h().heapGrowthSeverity === 'warn'
                              ? 'warn'
                              : 'err',
                        )
                  }
                >
                  {h().sampling ? 'sampling' : h().heapGrowthSeverity}
                </span>
              </header>
              <dl class="grid grid-cols-2 gap-x-6 gap-y-1 text-[0.8rem] md:grid-cols-4">
                <Stat label="Heap growth">
                  {h().sampling
                    ? 'measuring…'
                    : `${formatBytes(h().heapGrowthBytesPerSec * 60)}/min`}
                </Stat>
                <Stat label="GC reclaim" metric="gc.reclaim">
                  {h().sampling ? '—' : formatPercent(h().gcReclaimRatio)}
                </Stat>
                <Stat label="Heap of limit" metric="heap.utilization">
                  {formatPercent(h().heapUtilization)}
                </Stat>
                <Stat label="Open handles">{h().activeHandles}</Stat>
              </dl>
              <Show when={Object.keys(h().handlesByType).length > 0}>
                <div class="mt-2 flex flex-wrap gap-1.5">
                  <For each={Object.entries(h().handlesByType).toSorted((a, b) => b[1] - a[1])}>
                    {([type, count]) => (
                      <span class="dt-tone dt-tone-gray font-mono">
                        {type} {count}
                      </span>
                    )}
                  </For>
                </div>
              </Show>
              <Show when={h().sampling}>
                <p class="mt-2 text-xs text-text-muted">
                  Growth is judged once the process has run past its startup — about 50 seconds.
                </p>
              </Show>
            </section>
          )}
        </Show>
      </div>
    </Show>
  )
}

const Stat: Component<{ label: string; metric?: string; children: unknown }> = (props) => (
  <div>
    <dt class="text-xs text-text-muted">
      {props.label}
      <Show when={props.metric}>
        <InfoTip metric={props.metric as never} />
      </Show>
    </dt>
    <dd class="m-0 font-semibold tabular-nums">{props.children as Element}</dd>
  </div>
)

const actionButton =
  'rounded-md border border-border-strong bg-surface-2 px-2.5 py-1 text-xs text-text-secondary hover:text-text-strong disabled:opacity-50'

/** Download a V8 heap snapshot — open it in Chrome DevTools' Memory tab. */
const SnapshotButton: Component = () => {
  const [state, setState] = createSignal<string | null>(null)
  const [pending, setPending] = createSignal(false)
  const capture = async (): Promise<void> => {
    setPending(true)
    setState(null)
    try {
      const res = await post('/memory/snapshot')
      const blob = await res.blob()
      const name =
        /filename="?([^";]+)"?/.exec(res.headers.get('content-disposition') ?? '')?.[1] ??
        `kickjs-heap-${Date.now()}.heapsnapshot`
      const url = URL.createObjectURL(blob)
      const a = Object.assign(document.createElement('a'), { href: url, download: name })
      a.click()
      URL.revokeObjectURL(url)
      setState(`Saved ${name} (${formatBytes(blob.size)})`)
    } catch (err) {
      setState(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }
  return (
    <>
      <Show when={state()}>
        <span class="max-w-80 truncate text-text-muted" title={state()!}>
          {state()}
        </span>
      </Show>
      <button
        type="button"
        class={actionButton}
        disabled={pending()}
        onClick={() => void capture()}
        title="Blocks the event loop for a few seconds — avoid in production"
      >
        {pending() ? 'Capturing…' : 'Heap snapshot'}
      </button>
    </>
  )
}

/** Force a GC — if the heap drops back, growth was garbage, not retention. */
const GcButton: Component = () => {
  const [state, setState] = createSignal<string | null>(null)
  const [pending, setPending] = createSignal(false)
  const run = async (): Promise<void> => {
    setPending(true)
    setState(null)
    try {
      const r = (await (await post('/memory/gc')).json()) as {
        reclaimedBytes: number
        elapsedMs: number
      }
      setState(`GC freed ${formatBytes(r.reclaimedBytes)} in ${r.elapsedMs}ms`)
    } catch (err) {
      setState(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }
  return (
    <>
      <Show when={state()}>
        <span class="max-w-80 truncate text-text-muted" title={state()!}>
          {state()}
        </span>
      </Show>
      <button
        type="button"
        class={actionButton}
        disabled={pending()}
        onClick={() => void run()}
        title="Needs node --expose-gc"
      >
        {pending() ? 'Collecting…' : 'Run GC'}
      </button>
    </>
  )
}
