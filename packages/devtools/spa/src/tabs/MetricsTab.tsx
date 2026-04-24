import { createMemo, createSignal, For, onMount, Show, type Component } from 'solid-js'
import { rpc } from '../lib/rpc'
import { formatMs, formatPercent, formatUptime } from '../lib/format'

interface MetricsResponse {
  requests: number
  serverErrors: number
  clientErrors: number
  errorRate: number
  uptimeSeconds: number
  startedAt: string
  routeLatency: Record<
    string,
    {
      count: number
      totalMs: number
      minMs: number
      maxMs: number
      p50: number
      p95: number
      p99: number
    }
  >
}

export const MetricsTab: Component = () => {
  const [metrics, setMetrics] = createSignal<MetricsResponse | null>(null)
  const [error, setError] = createSignal<string | null>(null)

  const refresh = async (): Promise<void> => {
    try {
      setMetrics(await rpc.routes())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  onMount(() => {
    void refresh()
    // Routes tab polls every 2s — slower than Runtime/Memory (1s SSE)
    // because route stats change less frequently and a per-request
    // SSE push would be wasteful when most requests don't change the
    // displayed table much.
    const id = setInterval(() => void refresh(), 2000)
    return () => clearInterval(id)
  })

  const rows = createMemo(() => {
    const data = metrics()
    if (!data) return []
    return Object.entries(data.routeLatency)
      .map(([key, stats]) => ({
        key,
        ...stats,
        avg: stats.count > 0 ? stats.totalMs / stats.count : 0,
      }))
      .sort((a, b) => b.count - a.count)
  })

  return (
    <>
      <Show when={error()}>
        {(msg) => (
          <div class="card" style="border-color:var(--critical)">
            <div class="card-title" style="color:var(--critical)">
              Failed to load metrics
            </div>
            <code>{msg()}</code>
          </div>
        )}
      </Show>

      <Show when={metrics()} fallback={<div class="empty">Loading route metrics…</div>}>
        {(data) => (
          <>
            <div class="grid">
              <Card title="Requests" value={data().requests.toString()} />
              <Card title="Server errors" value={data().serverErrors.toString()} />
              <Card title="Client errors" value={data().clientErrors.toString()} />
              <Card title="Error rate" value={formatPercent(data().errorRate)} />
              <Card title="Uptime" value={formatUptime(data().uptimeSeconds)} />
            </div>

            <div class="card">
              <div class="card-header">
                <div class="card-title">Per-route latency</div>
              </div>
              <Show
                when={rows().length > 0}
                fallback={<div class="empty">No requests recorded yet</div>}
              >
                <table>
                  <thead>
                    <tr>
                      <th>Route</th>
                      <th style="text-align:right">Calls</th>
                      <th style="text-align:right">Avg</th>
                      <th style="text-align:right">p50</th>
                      <th style="text-align:right">p95</th>
                      <th style="text-align:right">p99</th>
                      <th style="text-align:right">Max</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={rows()}>
                      {(row) => (
                        <tr>
                          <td>{row.key}</td>
                          <td style="text-align:right">{row.count}</td>
                          <td style="text-align:right">{formatMs(row.avg)}</td>
                          <td style="text-align:right">{formatMs(row.p50)}</td>
                          <td style="text-align:right">{formatMs(row.p95)}</td>
                          <td style="text-align:right">{formatMs(row.p99)}</td>
                          <td style="text-align:right">{formatMs(row.maxMs)}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </Show>
            </div>
          </>
        )}
      </Show>
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
