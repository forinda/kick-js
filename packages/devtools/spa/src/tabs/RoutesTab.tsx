/**
 * Routes — a searchable list on the left, grouped by controller, and the API
 * runner for the selected route on the right. The divider position is
 * remembered.
 *
 * Reads the shared store (`store.routes()`, fed by the unified stream).
 */

import { createMemo, createSignal, For, Show, type Component } from 'solid-js'
import { store, type RouteEntry } from '../lib/store'
import { ApiRunnerPanel, openApiRunner, runnerRoute } from '../lib/api-runner'
import { methodColor } from '../lib/format'
import { SplitPane } from '../lib/split-pane'

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

  const isSelected = (r: RouteEntry) => {
    const s = runnerRoute()
    return !!s && s.method === r.method && s.path === r.path
  }

  const list = (
    <>
      <div class="dt-list-bar">
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
        <div class="text-xs dt-dim">
          <Show when={search() || method() !== 'ALL'}>{filtered().length} matched · </Show>
          {store.routes().length} routes
        </div>
      </div>
      <div class="dt-list">
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
                <div class="dt-list-group">
                  {controller} <span class="font-normal">({routes.length})</span>
                </div>
                <For each={routes}>
                  {(r) => (
                    <button
                      type="button"
                      class={`dt-list-row ${isSelected(r) ? 'selected' : ''}`}
                      onClick={() => openApiRunner(r)}
                      title={`${r.controller}.${r.handler}${
                        r.middleware.length ? ` · middleware: ${r.middleware.join(', ')}` : ''
                      }`}
                    >
                      <span class={`dt-method ${methodColor(r.method)}`}>{r.method}</span>
                      <span class="dt-mono-trunc flex-1">{r.path}</span>
                      <Show when={formatFlags(r.flags)}>
                        {(f) => (
                          <span class="text-[0.66rem] dt-dim truncate max-w-[40%]">{f()}</span>
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
