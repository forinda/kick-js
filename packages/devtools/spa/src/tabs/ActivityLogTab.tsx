/**
 * Activity — the live event-bus stream, newest first. Filter by namespace
 * (the part of the type before `:`, each chip with its count) or text;
 * errors and warnings are tinted. Scrolling down holds the list still and
 * counts what arrived; **N new** jumps back to the top. Selecting a row
 * shows its full payload beside the list.
 */

import { createMemo, createSignal, For, Show, type Component } from 'solid-js'
import type { KickDevtoolsEvent } from '@forinda/kickjs-devtools-kit/bus'
import { ACTIVITY_BUFFER_CAP, clearRecentEvents, recentBusEvents } from '../lib/bus'
import { formatActivityTs, summarisePayload } from '../lib/payload-summary'
import { hashColor } from '../lib/format'
import { SplitPane } from '../lib/split-pane'

const namespaceOf = (type: string): string => type.split(':')[0] || type

/** How loud an event is, read from its type name. */
function levelOf(type: string): 'err' | 'warn' | 'info' {
  if (/error|fail|crash/i.test(type)) return 'err'
  if (/warn|slow|retry|timeout/i.test(type)) return 'warn'
  return 'info'
}

/** The payload as indented JSON — or the one-line summary when it won't serialise (BigInt, cycles). */
function pretty(payload: unknown): string {
  try {
    return JSON.stringify(payload, null, 2) ?? String(payload)
  } catch {
    return summarisePayload(payload)
  }
}

export const ActivityLogTab: Component = () => {
  const events = recentBusEvents()
  const [search, setSearch] = createSignal('')
  const [hidden, setHidden] = createSignal<ReadonlySet<string>>(new Set())
  const [selected, setSelected] = createSignal<KickDevtoolsEvent | null>(null)
  /** The list as it was when the user scrolled away or paused; `null` = live. */
  const [held, setHeld] = createSignal<KickDevtoolsEvent[] | null>(null)
  const [paused, setPaused] = createSignal(false)
  let list: HTMLDivElement | undefined

  const namespaces = createMemo(() => {
    const counts = new Map<string, number>()
    for (const e of events())
      counts.set(namespaceOf(e.type), (counts.get(namespaceOf(e.type)) ?? 0) + 1)
    return [...counts].toSorted((a, b) => b[1] - a[1])
  })
  const filter = (source: readonly KickDevtoolsEvent[]): KickDevtoolsEvent[] => {
    const q = search().trim().toLowerCase()
    return source
      .filter(
        (e) =>
          !hidden().has(namespaceOf(e.type)) &&
          (!q ||
            e.type.toLowerCase().includes(q) ||
            summarisePayload(e.payload).toLowerCase().includes(q)),
      )
      .toReversed()
  }
  const visible = createMemo(() => filter(held() ?? events()))
  const pending = createMemo(() => (held() ? filter(events()).length - visible().length : 0))

  const hold = (): void => {
    if (!held()) setHeld(events())
  }
  const resume = (): void => {
    setPaused(false)
    setHeld(null)
    list?.scrollTo({ top: 0 })
  }
  const onScroll = (): void => {
    if (!list || paused()) return
    if (list.scrollTop > 8) hold()
    else setHeld(null)
  }
  const toggleNamespace = (ns: string): void => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(ns)) next.delete(ns)
      else next.add(ns)
      return next
    })
  }

  const tint = { err: 'bg-red-500/8', warn: 'bg-amber-500/8', info: '' }
  const bar = {
    err: 'shadow-[inset_2px_0_0_0_#ef4444]',
    warn: 'shadow-[inset_2px_0_0_0_#f59e0b]',
    info: '',
  }

  const left = (
    <>
      <div class="flex flex-col gap-1.5 border-b border-border p-2">
        <div class="flex items-center gap-1.5">
          <input
            type="text"
            placeholder="Search type or payload…"
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
            class="min-w-0 flex-1 bg-surface-2 border border-border-strong rounded-lg px-3 py-1.5 text-sm text-text-body placeholder:text-text-muted focus:outline-none focus:border-kick-500"
          />
          <button
            type="button"
            class="rounded-md border border-border-strong bg-surface-2 px-2 py-1 text-xs text-text-secondary hover:text-text-strong"
            onClick={() => {
              if (paused()) resume()
              else {
                setPaused(true)
                hold()
              }
            }}
          >
            {paused() ? 'Resume' : 'Pause'}
          </button>
          <button
            type="button"
            class="rounded-md border border-border-strong bg-surface-2 px-2 py-1 text-xs text-text-secondary hover:text-text-strong"
            onClick={() => {
              clearRecentEvents()
              setHeld(null)
              setSelected(null)
            }}
          >
            Clear
          </button>
        </div>
        <Show when={namespaces().length > 0}>
          <div class="flex flex-wrap gap-1">
            <For each={namespaces()}>
              {([ns, count]) => (
                <button
                  type="button"
                  aria-pressed={!hidden().has(ns)}
                  onClick={() => toggleNamespace(ns)}
                  class={`flex items-center gap-1 rounded-md border border-border-strong px-1.5 py-0.5 text-[0.68rem] font-semibold ${
                    hidden().has(ns) ? 'opacity-40' : 'bg-surface-2'
                  }`}
                >
                  <span class="h-1.5 w-1.5 rounded-full" style={{ background: hashColor(ns) }} />
                  {ns}
                  <span class="font-normal text-text-muted">{count}</span>
                </button>
              )}
            </For>
          </div>
        </Show>
        <div class="flex items-center text-xs text-text-muted">
          <span>
            {visible().length} shown · {events().length}/{ACTIVITY_BUFFER_CAP} kept
          </span>
          <span class="flex-1" />
          <Show when={held()}>
            <span class="text-amber-500">{paused() ? 'paused' : 'held while scrolled'}</span>
          </Show>
        </div>
      </div>
      <div class="relative min-h-0 flex-1">
        <Show when={pending() > 0}>
          <button
            type="button"
            class="absolute top-2 left-1/2 z-10 -translate-x-1/2 rounded-full bg-kick-500 px-3 py-0.5 text-xs font-semibold text-white shadow"
            onClick={resume}
          >
            {pending()} new ↑
          </button>
        </Show>
        <div ref={(el) => (list = el)} class="h-full overflow-y-auto" onScroll={onScroll}>
          <Show
            when={visible().length > 0}
            fallback={
              <div class="empty">
                {events().length
                  ? 'No events match'
                  : 'No events yet — kick/db queries, queue jobs and anything emitted on DEVTOOLS_BUS show up here.'}
              </div>
            }
          >
            <For each={visible()}>
              {(e) => (
                <button
                  type="button"
                  class={`flex w-full cursor-pointer items-center gap-2 border-0 border-b border-border/50 px-2.5 py-1 text-left text-[0.76rem] text-text-body ${
                    tint[levelOf(e.type)]
                  } ${bar[levelOf(e.type)]} ${selected() === e ? '!bg-accent/12' : 'hover:bg-surface-hover'}`}
                  onClick={() => setSelected(e)}
                >
                  <span class="w-[5.6rem] shrink-0 font-mono text-[0.68rem] text-text-muted tabular-nums">
                    {formatActivityTs(e.ts)}
                  </span>
                  <span class="flex w-36 shrink-0 items-center gap-1.5 truncate font-mono text-[0.72rem] font-semibold">
                    <span
                      class="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: hashColor(namespaceOf(e.type)) }}
                    />
                    {e.type}
                  </span>
                  <span class="min-w-0 flex-1 truncate font-mono text-[0.7rem] text-text-secondary">
                    {summarisePayload(e.payload)}
                  </span>
                </button>
              )}
            </For>
          </Show>
        </div>
      </div>
    </>
  )

  const right = (
    <Show
      when={selected()}
      fallback={
        <div class="dt-panel-grid">
          <div class="card text-sm text-text-muted">Select an event to see its payload</div>
        </div>
      }
    >
      {(e) => (
        <section class="flex h-full flex-col gap-2 overflow-y-auto bg-surface-1 p-4 text-[0.8rem]">
          <header class="flex items-center gap-2">
            <span
              class="h-2 w-2 rounded-full"
              style={{ background: hashColor(namespaceOf(e().type)) }}
            />
            <h2 class="m-0 font-mono text-sm text-text-strong">{e().type}</h2>
          </header>
          <div class="text-xs text-text-muted">
            {new Date(e().ts).toLocaleString()} · {formatActivityTs(e().ts)}
            <Show when={e().pluginId}> · from {e().pluginId}</Show>
          </div>
          <pre class="m-0 overflow-x-auto rounded-md border border-border bg-surface-2 p-3 font-mono text-xs leading-relaxed">
            {pretty(e().payload)}
          </pre>
        </section>
      )}
    </Show>
  )

  return <SplitPane storageKey="activity" left={left} right={right} defaultLeft={560} />
}
