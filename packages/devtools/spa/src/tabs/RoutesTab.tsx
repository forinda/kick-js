/**
 * Route registry tab — method/path/controller/handler/middleware
 * listing with search + method-filter + pagination.
 *
 * Sources its data from the shared store (`store.routes()`), which
 * is populated by the unified /stream consumer. Filters are local
 * (per-tab signals); the unified store is the source of truth for
 * the unfiltered list.
 *
 * Mirrors the legacy Vue dashboard's Routes tab exactly so adopters
 * who used the old dashboard see the same affordances.
 */

import { createMemo, createSignal, For, Show, type Component } from 'solid-js'
import { store, type RouteEntry } from '../lib/store'
import { Pagination, usePagination } from '../lib/pagination'

const METHODS = ['ALL', 'GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const
type MethodFilter = (typeof METHODS)[number]

export const RoutesTab: Component = () => {
  const [search, setSearch] = createSignal('')
  const [method, setMethod] = createSignal<MethodFilter>('ALL')

  const filtered = createMemo<RouteEntry[]>(() => {
    let rows = store.routes() as RouteEntry[]
    if (method() !== 'ALL') {
      rows = rows.filter((r) => r.method.toUpperCase() === method())
    }
    const q = search().trim().toLowerCase()
    if (q) {
      rows = rows.filter(
        (r) =>
          r.path.toLowerCase().includes(q) ||
          r.controller.toLowerCase().includes(q) ||
          r.handler.toLowerCase().includes(q),
      )
    }
    return rows
  })

  const pager = usePagination<RouteEntry>(() => filtered(), { pageSize: 20 })

  return (
    <div class="bg-slate-900 rounded-xl border border-slate-800 p-5">
      {/* Toolbar — search + method pills */}
      <div class="flex flex-col sm:flex-row gap-3 mb-4">
        <div class="relative flex-1">
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
            placeholder="Search routes (path, controller, handler)…"
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
            class="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-sm
                   text-slate-200 placeholder-slate-500 focus:outline-none focus:border-kick-500"
          />
        </div>
        <div class="flex gap-1">
          <For each={METHODS}>
            {(m) => (
              <button
                type="button"
                onClick={() => setMethod(m)}
                class={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors border ${
                  method() === m
                    ? 'bg-kick-500/20 text-kick-500 border-kick-500/30'
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                }`}
              >
                {m}
              </button>
            )}
          </For>
        </div>
      </div>

      {/* Table */}
      <Show
        when={pager.page().length > 0}
        fallback={
          <div class="empty">
            {search() || method() !== 'ALL'
              ? 'No routes match the current filter'
              : 'No routes registered'}
          </div>
        }
      >
        <div class="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Method</th>
                <th>Path</th>
                <th>Controller</th>
                <th>Handler</th>
                <th>Middleware</th>
              </tr>
            </thead>
            <tbody>
              <For each={pager.page()}>
                {(r) => (
                  <tr>
                    <td>
                      <span class={`text-xs font-bold ${methodColor(r.method)}`}>{r.method}</span>
                    </td>
                    <td class="font-mono text-sm">{r.path}</td>
                    <td>{r.controller}</td>
                    <td class="text-slate-400">{r.handler}</td>
                    <td class="text-slate-500 text-xs">
                      {r.middleware.length ? r.middleware.join(', ') : '—'}
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

/** HTTP method → text colour. Mirrors the legacy palette. */
function methodColor(method: string): string {
  const m = method.toUpperCase()
  if (m === 'GET') return 'text-emerald-400'
  if (m === 'POST') return 'text-cyan-400'
  if (m === 'PUT' || m === 'PATCH') return 'text-amber-400'
  if (m === 'DELETE') return 'text-red-400'
  return 'text-slate-400'
}
