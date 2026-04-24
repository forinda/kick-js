/**
 * Queues tab — per-queue stat cards (waiting / active / completed /
 * failed / delayed / paused) for any BullMQ queues registered via
 * `@forinda/kickjs-queue`.
 *
 * Sources rows from store.queues() — the unified /stream consumer
 * keeps it fresh without this tab owning a polling loop. Adopters
 * without QueueAdapter mounted see a friendly "no QueueAdapter
 * detected" message rather than a console error.
 */

import { createMemo, createSignal, For, Show, type Component } from 'solid-js'
import { store, type QueueStats } from '../lib/store'
import { Pagination, usePagination } from '../lib/pagination'

export const QueuesTab: Component = () => {
  const [search, setSearch] = createSignal('')

  const filtered = createMemo<QueueStats[]>(() => {
    const all = store.queues().queues
    const q = search().trim().toLowerCase()
    if (!q) return all
    return all.filter((row) => row.name.toLowerCase().includes(q))
  })

  const pager = usePagination<QueueStats>(() => filtered(), { pageSize: 12 })

  return (
    <Show
      when={store.queues().enabled}
      fallback={
        <div class="card">
          <div class="card-title">Queues</div>
          <p class="text-slate-500 text-sm mt-2">
            QueueAdapter not detected. Install <code class="font-mono text-kick-500">@forinda/kickjs-queue</code>{' '}
            and register the adapter in your bootstrap to see queue stats here.
          </p>
        </div>
      }
    >
      <Show
        when={store.queues().queues.length > 0}
        fallback={<div class="empty">No queues registered</div>}
      >
        <div class="bg-slate-900 rounded-xl border border-slate-800 p-5">
          {/* Search */}
          <div class="relative mb-4">
            <svg
              class="absolute left-3 top-2.5 w-4 h-4 text-slate-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              placeholder="Search queues by name…"
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
              class="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-sm
                     text-slate-200 placeholder-slate-500 focus:outline-none focus:border-kick-500"
            />
          </div>

          {/* Cards grid */}
          <Show
            when={pager.page().length > 0}
            fallback={<div class="empty">No queues match the search</div>}
          >
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <For each={pager.page()}>{(q) => <QueueCard queue={q} />}</For>
            </div>
            <Pagination pager={pager} />
          </Show>
        </div>
      </Show>
    </Show>
  )
}

const QueueCard: Component<{ queue: QueueStats }> = (props) => {
  return (
    <div class="bg-slate-800/50 rounded-lg border border-slate-700 p-4">
      <h3 class="font-mono text-sm font-semibold text-kick-500 mb-3 break-all">
        {props.queue.name}
      </h3>
      <Show
        when={!props.queue.error}
        fallback={<div class="text-red-400 text-sm">{props.queue.error}</div>}
      >
        <div class="grid grid-cols-2 gap-2 text-sm">
          <Stat label="Waiting" value={props.queue.waiting ?? 0} colour="text-amber-400" />
          <Stat label="Active" value={props.queue.active ?? 0} colour="text-blue-400" />
          <Stat
            label="Completed"
            value={props.queue.completed ?? 0}
            colour="text-emerald-400"
          />
          <Stat label="Failed" value={props.queue.failed ?? 0} colour="text-red-400" />
          <Stat label="Delayed" value={props.queue.delayed ?? 0} colour="text-violet-400" />
          <Stat label="Paused" value={props.queue.paused ?? 0} colour="text-slate-400" />
        </div>
      </Show>
    </div>
  )
}

const Stat: Component<{ label: string; value: number; colour: string }> = (props) => (
  <div class="flex justify-between">
    <span class="text-slate-400">{props.label}</span>
    <span class={`font-semibold tabular-nums ${props.colour}`}>{props.value}</span>
  </div>
)
