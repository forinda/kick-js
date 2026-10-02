/**
 * Database — the queries kick/db reports on the event bus (`db:query`,
 * `db:query-error`). **Slowest** groups statements that differ only in their
 * values and ranks them by total time; **Recent** is the raw log. Selecting
 * either shows the full SQL, parameters and error beside the list.
 *
 * Seeds from the activity buffer (the bus starts with the dashboard), then
 * follows the bus while open.
 */

import { createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from 'solid-js'
import { getBus, recentBusEvents } from '../lib/bus'
import { formatActivityTs } from '../lib/payload-summary'
import { durationTone, formatMs } from '../lib/format'
import { normalizeSql } from '../lib/sql'
import { percentile } from '../lib/stats'
import { SplitPane } from '../lib/split-pane'
import { createSort, SortHeader } from '../lib/sort'

/** One query, as kick/db reports it. */
interface DbQuery {
  sql: string
  parameters?: readonly unknown[]
  durationMs: number
  error?: string
  dialect?: string
  ts: number
}

interface QueryGroup {
  sql: string
  calls: number
  errors: number
  totalMs: number
  meanMs: number
  p95Ms: number
  last: DbQuery
}

/** Queries at or above this (ms) count as slow. */
const SLOW_MS = 50
const KEEP = 500

export const DatabaseTab: Component = () => {
  const [queries, setQueries] = createSignal<DbQuery[]>([])
  const [mode, setMode] = createSignal<'slowest' | 'recent'>('slowest')
  const [search, setSearch] = createSignal('')
  const [selected, setSelected] = createSignal<{ group?: QueryGroup; query?: DbQuery } | null>(null)
  const sort = createSort<'sql' | 'calls' | 'errors' | 'meanMs' | 'p95Ms' | 'totalMs'>('totalMs')

  const ingest = (q: DbQuery): void => {
    setQueries((prev) => [...prev, q].slice(-KEEP))
  }
  const fromError = (payload: unknown, ts: number): DbQuery => {
    const p = payload as { sql: string; parameters?: unknown[]; error?: unknown; dialect?: string }
    return {
      sql: p.sql,
      parameters: p.parameters,
      durationMs: 0,
      dialect: p.dialect,
      error: p.error instanceof Error ? p.error.message : String(p.error ?? 'query error'),
      ts,
    }
  }
  onMount(() => {
    for (const e of recentBusEvents()()) {
      if (e.type === 'db:query') ingest({ ...(e.payload as DbQuery), ts: e.ts })
      else if (e.type === 'db:query-error') ingest(fromError(e.payload, e.ts))
    }
    const bus = getBus()
    const offQuery = bus?.on('db:query', (payload) =>
      ingest({ ...(payload as DbQuery), ts: (payload as DbQuery).ts ?? Date.now() }),
    )
    const offErr = bus?.on('db:query-error', (payload) => ingest(fromError(payload, Date.now())))
    onCleanup(() => {
      offQuery?.()
      offErr?.()
    })
  })

  const matching = createMemo(() => {
    const q = search().trim().toLowerCase()
    return q ? queries().filter((r) => r.sql.toLowerCase().includes(q)) : queries()
  })
  const groups = createMemo<QueryGroup[]>(() => {
    const by = new Map<string, DbQuery[]>()
    for (const q of matching()) {
      const key = normalizeSql(q.sql)
      const list = by.get(key) ?? []
      list.push(q)
      by.set(key, list)
    }
    const out = [...by].map(([sql, list]) => {
      const ok = list.filter((q) => !q.error).map((q) => q.durationMs)
      const totalMs = ok.reduce((a, b) => a + b, 0)
      return {
        sql,
        calls: list.length,
        errors: list.length - ok.length,
        totalMs,
        meanMs: ok.length ? totalMs / ok.length : 0,
        p95Ms: percentile(ok, 95) ?? 0,
        last: list[list.length - 1]!,
      }
    })
    return sort.apply(out, (g, k) => g[k])
  })
  const slowestP95 = createMemo(() => Math.max(1, ...groups().map((g) => g.p95Ms)))
  const summary = createMemo(() => {
    const all = matching()
    const ok = all.filter((q) => !q.error).map((q) => q.durationMs)
    return {
      total: all.length,
      errors: all.length - ok.length,
      slow: ok.filter((d) => d >= SLOW_MS).length,
      p95: percentile(ok, 95),
    }
  })

  const segment = (m: 'slowest' | 'recent', label: string) => (
    <button
      type="button"
      aria-pressed={mode() === m}
      onClick={() => setMode(m)}
      class={`px-2.5 py-1 font-semibold ${
        mode() === m
          ? 'bg-kick-500/20 text-kick-500'
          : 'bg-surface-2 text-text-secondary hover:text-text-body'
      }`}
    >
      {label}
    </button>
  )
  const row = (active: boolean) =>
    `flex w-full cursor-pointer items-center gap-2 border-0 border-b border-border/50 px-2.5 py-1 text-left text-[0.76rem] text-text-body ${
      active
        ? 'bg-accent/12 shadow-[inset_2px_0_0_0_var(--color-accent)]'
        : 'bg-transparent hover:bg-surface-hover'
    }`

  const left = (
    <>
      <div class="flex flex-col gap-1.5 border-b border-border p-2">
        <div class="flex items-center gap-1.5">
          <input
            type="text"
            placeholder="Filter SQL…"
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
            class="min-w-0 flex-1 bg-surface-2 border border-border-strong rounded-lg px-3 py-1.5 text-sm text-text-body placeholder:text-text-muted focus:outline-none focus:border-kick-500"
          />
          <div class="flex overflow-hidden rounded-md border border-border-strong text-xs">
            {segment('slowest', 'Slowest')}
            {segment('recent', 'Recent')}
          </div>
        </div>
        <div class="flex flex-wrap gap-x-3 text-xs text-text-muted">
          <span>
            <b class="text-text-body tabular-nums">{summary().total}</b> queries
          </span>
          <span class={summary().errors ? 'text-red-500' : ''}>
            <b class="tabular-nums">{summary().errors}</b> failed
          </span>
          <span class={summary().slow ? 'text-amber-500' : ''}>
            <b class="tabular-nums">{summary().slow}</b> ≥ {SLOW_MS} ms
          </span>
          <Show when={summary().p95 !== undefined}>
            <span>
              p95 <b class="text-text-body tabular-nums">{formatMs(summary().p95!)}</b>
            </span>
          </Show>
          <Show when={mode() === 'slowest'}>
            <span>{groups().length} statements</span>
          </Show>
        </div>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <Show
          when={queries().length > 0}
          fallback={
            <div class="empty">
              No queries yet. kick/db reports each statement here when DevTools is installed — run
              one.
            </div>
          }
        >
          <Show
            when={mode() === 'slowest'}
            fallback={
              <For each={matching().toReversed()}>
                {(q) => (
                  <button
                    type="button"
                    class={row(selected()?.query === q)}
                    onClick={() => setSelected({ query: q })}
                  >
                    <span class="w-[5.6rem] shrink-0 font-mono text-[0.68rem] text-text-muted tabular-nums">
                      {formatActivityTs(q.ts)}
                    </span>
                    <span
                      class={`w-14 shrink-0 text-right tabular-nums ${
                        q.error ? 'text-red-500' : durationTone(q.durationMs, 4)
                      }`}
                    >
                      {q.error ? 'failed' : formatMs(q.durationMs)}
                    </span>
                    <span class="min-w-0 flex-1 truncate font-mono text-[0.7rem]">{q.sql}</span>
                  </button>
                )}
              </For>
            }
          >
            <table class="w-full table-fixed border-collapse text-[0.76rem]">
              <colgroup>
                <col />
                <col class="w-14" />
                <col class="w-16" />
                <col class="w-20" />
                <col class="w-32" />
                <col class="w-20" />
              </colgroup>
              <thead class="sticky top-0 z-1 border-b border-border bg-surface-2 text-xs">
                <tr>
                  {(
                    [
                      ['sql', 'Statement', 'left'],
                      ['calls', 'Calls'],
                      ['errors', 'Failed'],
                      ['meanMs', 'Mean'],
                      ['p95Ms', 'p95'],
                      ['totalMs', 'Total'],
                    ] as const
                  ).map(([k, label, align]) => (
                    <SortHeader
                      label={label}
                      align={align === 'left' ? 'left' : 'right'}
                      active={sort.key() === k}
                      desc={sort.desc()}
                      onClick={() => sort.toggle(k)}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                <For each={groups()}>
                  {(g) => (
                    <tr
                      class={`cursor-pointer border-b border-border/50 ${
                        selected()?.group?.sql === g.sql ? 'bg-accent/12' : 'hover:bg-surface-hover'
                      }`}
                      onClick={() => setSelected({ group: g, query: g.last })}
                    >
                      <td class="truncate px-2 py-1 font-mono text-[0.7rem]" title={g.sql}>
                        {g.sql}
                      </td>
                      <td class="px-2 py-1 text-right tabular-nums">{g.calls}</td>
                      <td
                        class={`px-2 py-1 text-right tabular-nums ${g.errors ? 'text-red-500' : 'text-text-muted'}`}
                      >
                        {g.errors || '—'}
                      </td>
                      <td class={`px-2 py-1 text-right tabular-nums ${durationTone(g.meanMs, 4)}`}>
                        {g.calls > g.errors ? formatMs(g.meanMs) : '—'}
                      </td>
                      <td class="px-2 py-1 text-right tabular-nums">
                        <span class="inline-flex items-center gap-1.5">
                          <span class="h-1.5 w-12 overflow-hidden rounded-full bg-border/60">
                            <span
                              class="block h-full rounded-full bg-kick-500/70"
                              style={{ width: `${(g.p95Ms / slowestP95()) * 100}%` }}
                            />
                          </span>
                          <span class={`min-w-12 ${durationTone(g.p95Ms, 4)}`}>
                            {g.calls > g.errors ? formatMs(g.p95Ms) : '—'}
                          </span>
                        </span>
                      </td>
                      <td class="px-2 py-1 text-right tabular-nums">{formatMs(g.totalMs)}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </Show>
        </Show>
      </div>
    </>
  )

  const right = (
    <Show
      when={selected()}
      fallback={
        <div class="dt-panel-grid">
          <div class="card text-sm text-text-muted">
            Select a query to see its SQL and parameters
          </div>
        </div>
      }
    >
      {(sel) => (
        <section class="flex h-full flex-col gap-3 overflow-y-auto bg-surface-1 p-4 text-[0.8rem]">
          <Show when={sel().group}>
            {(g) => (
              <dl class="grid grid-cols-3 gap-2">
                <Stat label="Calls">{g().calls}</Stat>
                <Stat label="Mean">{g().calls > g().errors ? formatMs(g().meanMs) : '—'}</Stat>
                <Stat label="p95">{g().calls > g().errors ? formatMs(g().p95Ms) : '—'}</Stat>
              </dl>
            )}
          </Show>
          <Show when={sel().query}>
            {(q) => (
              <>
                <div class="text-xs text-text-muted">
                  {sel().group ? 'Latest call · ' : ''}
                  {new Date(q().ts).toLocaleString()}
                  <Show when={q().dialect}> · {q().dialect}</Show>
                  <Show when={!q().error}> · {formatMs(q().durationMs)}</Show>
                </div>
                <Show when={q().error}>
                  <div class="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-500">
                    {q().error}
                  </div>
                </Show>
                <Block title="SQL">
                  <pre class="m-0 whitespace-pre-wrap break-words rounded-md border border-border bg-surface-2 p-3 font-mono text-xs">
                    {q().sql}
                  </pre>
                </Block>
                <Show when={q().parameters?.length}>
                  <Block title={`Parameters (${q().parameters!.length})`}>
                    <ol class="m-0 list-none rounded-md border border-border bg-surface-2 p-2 font-mono text-xs">
                      <For each={q().parameters}>
                        {(p, i) => (
                          <li class="flex gap-3 py-0.5">
                            <span class="w-6 text-right text-text-muted">${i() + 1}</span>
                            <span class="break-all">{JSON.stringify(p) ?? String(p)}</span>
                          </li>
                        )}
                      </For>
                    </ol>
                  </Block>
                </Show>
              </>
            )}
          </Show>
        </section>
      )}
    </Show>
  )

  return <SplitPane storageKey="database" left={left} right={right} defaultLeft={600} />
}

const Stat: Component<{ label: string; children: unknown }> = (props) => (
  <div class="rounded-md border border-border bg-surface-2 px-3 py-2">
    <dt class="text-[0.66rem] uppercase tracking-wider text-text-muted">{props.label}</dt>
    <dd class="m-0 font-semibold tabular-nums">{props.children as Element}</dd>
  </div>
)

const Block: Component<{ title: string; children: unknown }> = (props) => (
  <div>
    <h3 class="mb-1.5 text-[0.66rem] font-semibold uppercase tracking-wider text-text-muted">
      {props.title}
    </h3>
    {props.children as Element}
  </div>
)
