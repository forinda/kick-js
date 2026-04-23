import { createMemo, createSignal, onCleanup, onMount, Show, type Component, For } from 'solid-js'
import type { MemoryHealth, RuntimeSnapshot } from '@forinda/kickjs-devtools-kit'
import { Sparkline } from '../lib/sparkline'
import { rpc, subscribe } from '../lib/rpc'
import { formatBytes, formatBytesPerSec, formatPercent } from '../lib/format'

interface MemoryStream {
  snapshot: RuntimeSnapshot
  health: MemoryHealth
}

const HISTORY_CAP = 60

export const MemoryTab: Component = () => {
  const [latest, setLatest] = createSignal<MemoryStream | null>(null)
  const [heap, setHeap] = createSignal<number[]>([])
  const [connected, setConnected] = createSignal(false)

  const ingest = (event: MemoryStream): void => {
    setLatest(event)
    setHeap((prev) => [...prev, event.snapshot.memory.heapUsed].slice(-HISTORY_CAP))
  }

  onMount(() => {
    rpc
      .runtime()
      .then((data) => {
        if (data.latest) {
          ingest({ snapshot: data.latest, health: data.health })
          setHeap(data.history.map((s) => s.memory.heapUsed).slice(-HISTORY_CAP))
        }
        setConnected(true)
      })
      .catch(() => setConnected(false))

    const unsubscribe = subscribe<MemoryStream>(
      '/memory/stream',
      (event) => {
        setConnected(true)
        ingest(event)
      },
      () => setConnected(false),
    )
    onCleanup(unsubscribe)
  })

  const handles = createMemo(() => {
    const data = latest()
    if (!data) return [] as Array<[string, number]>
    return Object.entries(data.health.handlesByType).sort((a, b) => b[1] - a[1])
  })

  return (
    <>
      <Show when={latest()} fallback={<div class="empty">Loading memory metrics…</div>}>
        {(data) => (
          <>
            <div class="card">
              <div class="card-header">
                <div class="card-title">Leak risk</div>
                <span class={`badge badge-${data().health.heapGrowthSeverity}`}>
                  {data().health.heapGrowthSeverity}
                </span>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:baseline">
                <div class="card-value">
                  {formatBytesPerSec(data().health.heapGrowthBytesPerSec)} growth
                </div>
                <div class="card-value" style="font-size:13px;color:var(--text-dim)">
                  GC reclaim {formatPercent(data().health.gcReclaimRatio)} • heap util{' '}
                  {formatPercent(data().health.heapUtilization)}
                </div>
              </div>
              <Sparkline values={heap()} />
            </div>

            <div class="grid">
              <Card title="Heap used" value={formatBytes(data().snapshot.memory.heapUsed)} />
              <Card title="Heap total" value={formatBytes(data().snapshot.memory.heapTotal)} />
              <Card title="RSS" value={formatBytes(data().snapshot.memory.rss)} />
              <Card title="External" value={formatBytes(data().snapshot.memory.external)} />
            </div>

            <div class="card">
              <div class="card-header">
                <div class="card-title">Active handles</div>
                <div class="card-value">{data().health.activeHandles}</div>
              </div>
              <Show
                when={handles().length > 0}
                fallback={<div class="empty">No handle inventory available on this runtime.</div>}
              >
                <table>
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th style="text-align:right">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={handles()}>
                      {([type, count]) => (
                        <tr>
                          <td>{type}</td>
                          <td style="text-align:right">{count}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </Show>
            </div>

            <div class="card">
              <div class="card-header">
                <div class="card-title">Heap snapshot</div>
              </div>
              <p style="margin:0;color:var(--text-dim);font-size:12px">
                Heap snapshot capture is queued for a follow-up release. Use{' '}
                <code>node --inspect</code> + Chrome DevTools for retained-size analysis in the
                meantime.
              </p>
            </div>
          </>
        )}
      </Show>
      <div class="status">
        <span>
          <span class={`status-dot ${connected() ? 'connected' : 'disconnected'}`} />
          {connected() ? 'streaming' : 'reconnecting…'}
        </span>
        <span>{heap().length} samples</span>
      </div>
    </>
  )
}

const Card: Component<{ title: string; value: string }> = (props) => (
  <div class="card">
    <div class="card-header">
      <div class="card-title">{props.title}</div>
      <div class="card-value">{props.value}</div>
    </div>
  </div>
)
