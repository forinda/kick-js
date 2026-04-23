import { createSignal, onCleanup, onMount, Show, type Component } from 'solid-js'
import type { RuntimeSnapshot } from '@forinda/kickjs-devtools-kit'
import { Sparkline } from '../lib/sparkline'
import { rpc, subscribe } from '../lib/rpc'
import { formatBytes, formatMs, formatUptime } from '../lib/format'

const HISTORY_CAP = 60

export const RuntimeTab: Component = () => {
  const [latest, setLatest] = createSignal<RuntimeSnapshot | null>(null)
  const [heap, setHeap] = createSignal<number[]>([])
  const [rss, setRss] = createSignal<number[]>([])
  const [eventLoopP99, setEventLoopP99] = createSignal<number[]>([])
  const [connected, setConnected] = createSignal(false)

  const ingest = (snap: RuntimeSnapshot): void => {
    setLatest(snap)
    setHeap((prev) => [...prev, snap.memory.heapUsed].slice(-HISTORY_CAP))
    setRss((prev) => [...prev, snap.memory.rss].slice(-HISTORY_CAP))
    setEventLoopP99((prev) => [...prev, snap.eventLoop.p99].slice(-HISTORY_CAP))
  }

  onMount(() => {
    // Bootstrap from the one-shot endpoint so we have *some* data
    // immediately. The SSE stream then takes over for live ticks.
    rpc
      .runtime()
      .then((data) => {
        for (const snap of data.history) ingest(snap)
        setConnected(true)
      })
      .catch(() => setConnected(false))

    const unsubscribe = subscribe<RuntimeSnapshot>(
      '/runtime/stream',
      (snap) => {
        setConnected(true)
        ingest(snap)
      },
      () => setConnected(false),
    )
    onCleanup(unsubscribe)
  })

  return (
    <>
      <Show when={latest()} fallback={<div class="empty">Loading runtime metrics…</div>}>
        {(snap) => (
          <>
            <div class="grid">
              <Card title="Heap used" value={formatBytes(snap().memory.heapUsed)}>
                <Sparkline values={heap()} />
              </Card>
              <Card title="RSS" value={formatBytes(snap().memory.rss)}>
                <Sparkline values={rss()} />
              </Card>
              <Card title="Event loop p99" value={formatMs(snap().eventLoop.p99)}>
                <Sparkline values={eventLoopP99()} />
              </Card>
              <Card title="Uptime" value={formatUptime(snap().uptimeSec)}>
                <div class="empty" style="padding:0;text-align:left;font-size:11px">
                  GC: {snap().gc.count} runs, {formatMs(snap().gc.totalPauseMs)} total
                </div>
              </Card>
            </div>

            <div class="grid">
              <Card title="External" value={formatBytes(snap().memory.external)} />
              <Card title="Array buffers" value={formatBytes(snap().memory.arrayBuffers)} />
              <Card title="Heap total" value={formatBytes(snap().memory.heapTotal)} />
              <Card
                title="CPU (last sample)"
                value={`${(snap().cpu.userMicros / 1000).toFixed(1)} ms u / ${(snap().cpu.systemMicros / 1000).toFixed(1)} ms s`}
              />
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

const Card: Component<{ title: string; value: string; children?: unknown }> = (props) => (
  <div class="card">
    <div class="card-header">
      <div class="card-title">{props.title}</div>
      <div class="card-value">{props.value}</div>
    </div>
    {props.children as unknown as Element}
  </div>
)
