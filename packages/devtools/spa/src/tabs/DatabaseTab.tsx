/**
 * Database tab — live `kick/db` query telemetry.
 *
 * Subscribes to `db:query` events on the runtime KickEventBus (emitted by
 * `@forinda/kickjs-db` when DevTools is installed) and renders a recent-query
 * table with per-query duration, row count, dialect, and errors, plus headline
 * counters (total / errors / slow) and a slow-query highlight. Seeds from the
 * shared activity buffer so queries fired before the tab opened still show.
 *
 * The bus carries nothing until `kick/db` emits — see the empty state.
 */

import { createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from 'solid-js'
import { getBus, recentBusEvents } from '../lib/bus'
import { formatActivityTs } from '../lib/payload-summary'
import { formatMs } from '../lib/format'
import { Pagination, usePagination } from '../lib/pagination'

/** Payload of a `db:query` bus event (mirrors what kick/db emits). */
interface DbQuery {
  sql: string
  parameters?: readonly unknown[]
  durationMs: number
  error?: string
  dialect?: string
  ts: number
}

/** Queries slower than this (ms) are flagged. */
const SLOW_MS = 50
const BUFFER_CAP = 300

export const DatabaseTab: Component = () => {
  const [queries, setQueries] = createSignal<DbQuery[]>([])
  const [filter, setFilter] = createSignal('')

  const ingest = (q: DbQuery): void => {
    setQueries((prev) => {
      const next = prev.length >= BUFFER_CAP ? prev.slice(1) : prev.slice()
      next.push(q)
      return next
    })
  }

  const fromError = (payload: unknown, ts: number): DbQuery => {
    const p = payload as { sql: string; parameters?: unknown[]; error?: unknown; dialect?: string }
    const error = p.error
    return {
      sql: p.sql,
      parameters: p.parameters,
      durationMs: 0,
      dialect: p.dialect,
      error: error instanceof Error ? error.message : String(error ?? 'query error'),
      ts,
    }
  }

  onMount(() => {
    // Seed from events already captured in the shared activity buffer
    // (the bus boots in App.tsx, before this tab is opened).
    for (const e of recentBusEvents()()) {
      if (e.type === 'db:query') ingest({ ...(e.payload as DbQuery), ts: e.ts })
      else if (e.type === 'db:query-error') ingest(fromError(e.payload, e.ts))
    }
    // Live subscriptions — successes on db:query, failures on db:query-error.
    const bus = getBus()
    const offQuery = bus?.on('db:query', (payload) => {
      const p = payload as DbQuery
      ingest({ ...p, ts: p.ts ?? Date.now() })
    })
    const offErr = bus?.on('db:query-error', (payload) => ingest(fromError(payload, Date.now())))
    onCleanup(() => {
      offQuery?.()
      offErr?.()
    })
  })

  const stats = createMemo(() => {
    const all = queries()
    const errors = all.filter((q) => q.error).length
    const slow = all.filter((q) => q.durationMs >= SLOW_MS).length
    const total = all.length
    const avg = total ? all.reduce((s, q) => s + q.durationMs, 0) / total : 0
    return { total, errors, slow, avg }
  })

  const visible = createMemo<DbQuery[]>(() => {
    const q = filter().trim().toLowerCase()
    const source = q ? queries().filter((row) => row.sql.toLowerCase().includes(q)) : queries()
    return [...source].toReversed() // newest first
  })

  const pager = usePagination<DbQuery>(() => visible())

  return (
    <div class="bg-surface-1 rounded-xl border border-border p-5">
      <div class="grid mb-4">
        <Stat label="Queries" value={String(stats().total)} />
        <Stat
          label="Errors"
          value={String(stats().errors)}
          tone={stats().errors ? 'err' : undefined}
        />
        <Stat
          label={`Slow (≥${SLOW_MS}ms)`}
          value={String(stats().slow)}
          tone={stats().slow ? 'warn' : undefined}
        />
        <Stat label="Avg duration" value={formatMs(stats().avg)} />
      </div>

      <input
        type="text"
        placeholder="Filter by SQL (substring)…"
        value={filter()}
        onInput={(e) => setFilter(e.currentTarget.value)}
        class="w-full bg-surface-2 border border-border-strong rounded-lg px-3 py-2 text-sm
               text-text-body placeholder:text-text-muted focus:outline-none focus:border-kick-500 mb-4"
      />

      <Show
        when={queries().length}
        fallback={
          <div class="empty">
            No queries yet. <code>kick/db</code> emits a <code>db:query</code> event per statement
            when DevTools is installed — run a query to see it here.
          </div>
        }
      >
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Dialect</th>
              <th class="text-right">Duration</th>
              <th>SQL</th>
            </tr>
          </thead>
          <tbody>
            <For each={pager.page()}>
              {(q) => (
                <tr>
                  <td class="dimmed">{formatActivityTs(q.ts)}</td>
                  <td>{q.dialect ?? '—'}</td>
                  <td
                    class="text-right"
                    style={
                      q.durationMs >= SLOW_MS ? 'color:var(--color-amber-400);font-weight:600' : ''
                    }
                  >
                    {formatMs(q.durationMs)}
                  </td>
                  <td>
                    <Show
                      when={!q.error}
                      fallback={<span style="color:var(--color-red-400)">{q.error}</span>}
                    >
                      <code class="break-all">{q.sql}</code>
                    </Show>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
        <Pagination pager={pager} />
      </Show>
    </div>
  )
}

const Stat: Component<{ label: string; value: string; tone?: 'err' | 'warn' }> = (props) => (
  <div class="card">
    <div class="card-header">
      <div class="card-title">{props.label}</div>
    </div>
    <div
      class="card-value"
      style={
        props.tone === 'err'
          ? 'color:var(--color-red-400)'
          : props.tone === 'warn'
            ? 'color:var(--color-amber-400)'
            : ''
      }
    >
      {props.value}
    </div>
  </div>
)
