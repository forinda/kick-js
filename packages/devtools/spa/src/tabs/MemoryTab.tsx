import { createMemo, createSignal, onCleanup, onMount, Show, type Component, For } from 'solid-js'
import type { MemoryHealth, RuntimeSnapshot } from '@forinda/kickjs-devtools-kit'
import { Sparkline } from '../lib/sparkline'
import { getBasePath, getToken, rpc, subscribe } from '../lib/rpc'
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

            <HeapSnapshotCard heapTotal={data().snapshot.memory.heapTotal} />
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

/**
 * "Take heap snapshot" button. POSTs to /_debug/memory/snapshot, waits
 * for the streamed `.heapsnapshot` file, then triggers a download via
 * an in-memory Blob URL (revoked immediately after the click handler
 * runs). Server-side single-flight prevents concurrent captures; this
 * UI also disables the button during capture so users can't queue
 * a second click.
 */
const HeapSnapshotCard: Component<{ heapTotal: number }> = (props) => {
  const [pending, setPending] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [lastSnapshot, setLastSnapshot] = createSignal<{ name: string; sizeBytes: number } | null>(
    null,
  )

  const capture = async (): Promise<void> => {
    setPending(true)
    setError(null)
    try {
      const token = getToken()
      const url = `${getBasePath()}/memory/snapshot${token ? `?token=${encodeURIComponent(token)}` : ''}`
      const res = await fetch(url, {
        method: 'POST',
        headers: token ? { 'x-devtools-token': token } : undefined,
      })
      if (!res.ok) {
        let serverMessage = `${res.status} ${res.statusText}`
        try {
          const body = (await res.json()) as { error?: string }
          if (body.error) serverMessage = body.error
        } catch {
          /* non-JSON response, keep status line */
        }
        throw new Error(serverMessage)
      }
      const blob = await res.blob()
      const filename =
        parseFilename(res.headers.get('content-disposition')) ??
        `kickjs-heap-${Date.now()}.heapsnapshot`
      triggerDownload(blob, filename)
      setLastSnapshot({ name: filename, sizeBytes: blob.size })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <div class="card">
      <div class="card-header">
        <div class="card-title">Heap snapshot</div>
        <div class="card-value" style="font-size:13px;color:var(--text-dim)">
          ~{formatBytes(props.heapTotal)} estimate
        </div>
      </div>
      <p style="margin:0 0 12px;color:var(--text-dim);font-size:12px">
        Captures a V8 heap snapshot for retained-size analysis in Chrome DevTools (Memory tab, Load
        profile). Capture blocks the event loop for several seconds — avoid in production.
      </p>
      <div style="display:flex;align-items:center;gap:12px">
        <button
          type="button"
          class="tab"
          style="border:1px solid var(--accent);border-radius:4px;padding:6px 14px;border-bottom-color:var(--accent);color:var(--accent)"
          disabled={pending()}
          onClick={() => void capture()}
        >
          {pending() ? 'Capturing…' : 'Take snapshot'}
        </button>
        <Show when={lastSnapshot()}>
          {(snap) => (
            <span style="color:var(--text-dim);font-size:12px;font-family:var(--font-mono)">
              Last: {snap().name} ({formatBytes(snap().sizeBytes)})
            </span>
          )}
        </Show>
      </div>
      <Show when={error()}>
        {(msg) => (
          <p style="margin:8px 0 0;color:var(--critical);font-size:12px;font-family:var(--font-mono)">
            {msg()}
          </p>
        )}
      </Show>
    </div>
  )
}

function parseFilename(header: string | null): string | null {
  if (!header) return null
  const match = /filename="?([^";]+)"?/.exec(header)
  return match ? match[1] : null
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
