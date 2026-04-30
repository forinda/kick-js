/**
 * Activity-log tab — wildcard subscriber over the runtime KickEventBus.
 * Renders the most recent N envelopes with type / pluginId / payload-
 * summary, plus pause / clear / filter affordances so an adopter can
 * focus on a noisy stream during debugging.
 *
 * Source: the singleton bus + ring-buffer in `lib/bus.ts`. Boot is
 * driven from App.tsx onMount so the log captures events emitted
 * before the user opens this tab.
 */

import { createMemo, createSignal, For, Show, type Component } from 'solid-js'
import type { KickDevtoolsEvent } from '@forinda/kickjs-devtools-kit/bus'

import { ACTIVITY_BUFFER_CAP, clearRecentEvents, recentBusEvents } from '../lib/bus'
import { formatActivityTs, summarisePayload } from '../lib/payload-summary'
import { Pagination, usePagination } from '../lib/pagination'

export const ActivityLogTab: Component = () => {
  const events = recentBusEvents()
  const [filter, setFilter] = createSignal('')
  const [paused, setPaused] = createSignal(false)

  // When paused we freeze the visible list at the moment of pause —
  // new events still flow into the ring buffer (other tabs might
  // care), but the activity log won't reshuffle until resumed.
  const [frozenSnapshot, setFrozenSnapshot] = createSignal<KickDevtoolsEvent[] | null>(null)

  const togglePause = () => {
    setPaused((p) => {
      const next = !p
      setFrozenSnapshot(next ? events() : null)
      return next
    })
  }

  const visible = createMemo<KickDevtoolsEvent[]>(() => {
    const source = frozenSnapshot() ?? events()
    const q = filter().trim().toLowerCase()
    const filtered = q ? source.filter((e) => e.type.toLowerCase().includes(q)) : source
    // Newest first reads better than chronological — the user looking
    // at the log is almost always asking "what just happened?"
    return [...filtered].toReversed()
  })

  const pager = usePagination<KickDevtoolsEvent>(() => visible())

  return (
    <div class="bg-surface-1 rounded-xl border border-border p-5">
      {/* Toolbar */}
      <div class="flex flex-col sm:flex-row gap-3 mb-4 items-stretch sm:items-center">
        <input
          type="text"
          placeholder="Filter by event type (substring)…"
          value={filter()}
          onInput={(e) => setFilter(e.currentTarget.value)}
          class="flex-1 bg-surface-2 border border-border-strong rounded-lg px-3 py-2 text-sm
                 text-text-body placeholder:text-text-muted focus:outline-none focus:border-kick-500"
        />
        <div class="flex gap-2">
          <button
            type="button"
            onClick={togglePause}
            class={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
              paused()
                ? 'bg-kick-500/20 text-kick-500 border-kick-500/30'
                : 'bg-surface-2 text-text-secondary border-border-strong hover:text-text-body'
            }`}
          >
            {paused() ? '▶ Resume' : '⏸ Pause'}
          </button>
          <button
            type="button"
            onClick={() => clearRecentEvents()}
            class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-surface-2 text-text-secondary
                   border border-border-strong hover:text-text-body transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Status line */}
      <div class="text-xs text-text-muted mb-3 font-mono">
        {events().length}/{ACTIVITY_BUFFER_CAP} buffered
        <Show when={paused()}> · paused</Show>
        <Show when={filter().trim()}> · filter: "{filter().trim()}"</Show>
      </div>

      <Show
        when={pager.page().length > 0}
        fallback={
          <div class="empty">
            <Show when={events().length === 0} fallback="No events match the current filter">
              No events yet — emits from kickjs-db, plugins, or the panel itself land here.
            </Show>
          </div>
        }
      >
        <div class="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th style="width:140px">Time</th>
                <th style="width:200px">Type</th>
                <th style="width:120px">Source</th>
                <th>Payload</th>
              </tr>
            </thead>
            <tbody>
              <For each={pager.page()}>
                {(event) => (
                  <tr>
                    <td class="font-mono text-xs text-text-muted">{formatActivityTs(event.ts)}</td>
                    <td class="font-mono text-xs">{event.type}</td>
                    <td class="font-mono text-xs text-text-secondary">{event.pluginId ?? '—'}</td>
                    <td class="font-mono text-xs">
                      <code class="text-text-body break-all">
                        {summarisePayload(event.payload)}
                      </code>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
        <Pagination pager={pager} />
      </Show>
    </div>
  )
}
