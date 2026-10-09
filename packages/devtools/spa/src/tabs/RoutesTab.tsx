/**
 * Routes — a searchable list on the left, grouped by controller, and the API
 * runner for the selected route on the right. The divider position and the
 * collapsed groups are remembered.
 *
 * Reads the shared store (`store.routes()`, fed by the unified stream).
 */

import { createMemo, createSignal, For, Show, type Component } from 'solid-js'
import { store, type RouteEntry } from '../lib/store'
import { ApiRunnerPanel, openApiRunner, runnerRoute } from '../lib/api-runner'
import { methodColor } from '../lib/format'
import { SplitPane } from '../lib/split-pane'

const COLLAPSED_KEY = 'kickjs-devtools:routes:collapsed'

function loadCollapsed(): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]')
    return new Set(Array.isArray(raw) ? raw.filter((c) => typeof c === 'string') : [])
  } catch {
    return new Set()
  }
}

const METHODS = ['ALL', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
type MethodFilter = (typeof METHODS)[number]

/** Resolved route flags; a `true` flag carries no more than its name. */
function formatFlags(flags?: Record<string, unknown>): string {
  return Object.entries(flags ?? {})
    .map(([k, v]) => (v === true ? k : `${k}=${JSON.stringify(v)}`))
    .join(', ')
}

export const RoutesTab: Component = () => {
  const [search, setSearch] = createSignal('')
  const [method, setMethod] = createSignal<MethodFilter>('ALL')

  const filtered = createMemo<RouteEntry[]>(() => {
    const q = search().trim().toLowerCase()
    return (store.routes() as RouteEntry[]).filter(
      (r) =>
        (method() === 'ALL' || r.method.toUpperCase() === method()) &&
        (!q ||
          r.path.toLowerCase().includes(q) ||
          r.controller.toLowerCase().includes(q) ||
          r.handler.toLowerCase().includes(q)),
    )
  })

  /** Routes grouped by controller, in first-seen order. */
  const groups = createMemo(() => {
    const byController = new Map<string, RouteEntry[]>()
    for (const r of filtered()) {
      const list = byController.get(r.controller) ?? []
      list.push(r)
      byController.set(r.controller, list)
    }
    return [...byController]
  })

  const [collapsed, setCollapsed] = createSignal(loadCollapsed())
  const setAll = (next: Set<string>) => {
    setCollapsed(next)
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]))
    } catch {
      /* storage unavailable */
    }
  }
  const toggle = (controller: string) => {
    const next = new Set(collapsed())
    if (!next.delete(controller)) next.add(controller)
    setAll(next)
  }
  /** A search or method filter shows every match, collapsed or not. */
  const isOpen = (controller: string) =>
    !!search().trim() || method() !== 'ALL' || !collapsed().has(controller)

  const isSelected = (r: RouteEntry) => {
    const s = runnerRoute()
    return !!s && s.method === r.method && s.path === r.path
  }

  const list = (
    <>
      <div class="flex flex-col gap-1.5 border-b border-border p-2">
        <input
          type="text"
          placeholder="Search path, controller, handler…"
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
          class="w-full bg-surface-2 border border-border-strong rounded-lg px-3 py-1.5 text-sm text-text-body placeholder:text-text-muted focus:outline-none focus:border-kick-500"
        />
        <div class="flex items-center gap-1 flex-wrap">
          <For each={METHODS}>
            {(m) => (
              <button
                type="button"
                onClick={() => setMethod(m)}
                aria-pressed={method() === m}
                class={`px-2 py-0.5 text-[0.68rem] font-semibold rounded-md border ${
                  method() === m
                    ? 'bg-kick-500/20 text-kick-500 border-kick-500/30'
                    : 'bg-surface-2 text-text-secondary border-border-strong hover:text-text-body'
                }`}
              >
                {m}
              </button>
            )}
          </For>
        </div>
        <div class="text-xs text-text-muted">
          <Show when={search() || method() !== 'ALL'}>{filtered().length} matched · </Show>
          {store.routes().length} routes
          <Show when={groups().length > 1}>
            {' · '}
            <button
              type="button"
              class="underline hover:text-text-body"
              onClick={() =>
                setAll(collapsed().size ? new Set() : new Set(groups().map(([c]) => c)))
              }
            >
              {collapsed().size ? 'Expand all' : 'Collapse all'}
            </button>
          </Show>
        </div>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <Show
          when={groups().length > 0}
          fallback={
            <div class="empty">
              {store.routes().length ? 'No routes match' : 'No routes registered'}
            </div>
          }
        >
          <For each={groups()}>
            {([controller, routes]) => (
              <>
                <button
                  type="button"
                  aria-expanded={isOpen(controller)}
                  onClick={() => toggle(controller)}
                  class="sticky top-0 z-1 flex w-full cursor-pointer items-center gap-1.5 border-0 border-b border-border bg-surface-2 px-2.5 py-1 text-left text-[0.66rem] font-bold uppercase tracking-wide text-text-muted hover:text-text-body"
                >
                  <span class="inline-block w-2.5">{isOpen(controller) ? '▾' : '▸'}</span>
                  {controller} <span class="font-normal">({routes.length})</span>
                </button>
                <For each={isOpen(controller) ? routes : []}>
                  {(r) => (
                    <button
                      type="button"
                      class={`flex w-full cursor-pointer items-center gap-2 border-0 border-b border-border/50 px-2.5 py-1 text-left text-[0.78rem] text-text-body ${
                        isSelected(r)
                          ? 'bg-accent/12 shadow-[inset_2px_0_0_0_var(--color-accent)]'
                          : 'bg-transparent hover:bg-surface-hover'
                      }`}
                      onClick={() => openApiRunner(r)}
                      title={`${r.controller}.${r.handler}${
                        r.middleware.length ? ` · middleware: ${r.middleware.join(', ')}` : ''
                      }`}
                    >
                      <span
                        class={`w-[3.4rem] shrink-0 font-mono text-[0.68rem] font-bold ${methodColor(r.method)}`}
                      >
                        {r.method}
                      </span>
                      <span class="min-w-0 flex-1 truncate font-mono">{r.path}</span>
                      <Show when={formatFlags(r.flags)}>
                        {(f) => (
                          <span class="max-w-[40%] truncate text-[0.66rem] text-text-muted">
                            {f()}
                          </span>
                        )}
                      </Show>
                    </button>
                  )}
                </For>
              </>
            )}
          </For>
        </Show>
      </div>
    </>
  )

  return <SplitPane storageKey="routes" left={list} right={<ApiRunnerPanel />} />
}
