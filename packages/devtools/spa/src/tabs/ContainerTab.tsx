/**
 * DI Container tab — searchable, filterable, expand-row table of
 * every registered DI token with kind/scope/status badges, resolve
 * stats, dependency chips, and PostConstruct status.
 *
 * Recovers the legacy Vue dashboard's Container tab — the most
 * frequently-used surface for "why is service X being resolved?"
 * debugging. Sources rows from store.container() (the unified
 * /stream consumer), all filters/expand-state are tab-local.
 */

import { createMemo, createSignal, For, Show, type Component } from 'solid-js'
import { store, type ContainerRegistration } from '../lib/store'
import { Pagination, usePagination } from '../lib/pagination'
import { InfoTip } from '../lib/info'
import { openDetailModal } from '../lib/detail-modal'

const KINDS = ['ALL', 'controller', 'service', 'repository', 'other'] as const
const SCOPES = ['ALL', 'singleton', 'transient', 'request'] as const
type KindFilter = (typeof KINDS)[number]
type ScopeFilter = (typeof SCOPES)[number]

export const ContainerTab: Component = () => {
  const [search, setSearch] = createSignal('')
  const [kind, setKind] = createSignal<KindFilter>('ALL')
  const [scope, setScope] = createSignal<ScopeFilter>('ALL')
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set())

  const filtered = createMemo<ContainerRegistration[]>(() => {
    let regs = store.container() as ContainerRegistration[]
    if (kind() !== 'ALL') {
      const k = kind()
      regs = regs.filter((r) => {
        if (k === 'other') {
          return !['controller', 'service', 'repository'].includes(r.kind ?? '')
        }
        return r.kind === k
      })
    }
    if (scope() !== 'ALL') {
      regs = regs.filter((r) => r.scope === scope())
    }
    const q = search().trim().toLowerCase()
    if (q) {
      regs = regs.filter((r) => r.token.toLowerCase().includes(q))
    }
    return regs
  })

  const pager = usePagination<ContainerRegistration>(() => filtered(), { pageSize: 20 })

  const toggleRow = (token: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(token)) next.delete(token)
      else next.add(token)
      return next
    })
  }

  return (
    <div class="bg-slate-900 rounded-xl border border-slate-800 p-5">
      {/* Toolbar — search + kind + scope */}
      <div class="flex flex-col gap-3 mb-4">
        <div class="relative">
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
            placeholder="Search tokens…"
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
            class="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-sm
                   text-slate-200 placeholder-slate-500 focus:outline-none focus:border-kick-500"
          />
        </div>
        <div class="flex flex-col sm:flex-row gap-3">
          <div class="flex gap-1 items-center">
            <span class="text-xs text-slate-500 mr-1">Kind:</span>
            <For each={KINDS}>
              {(k) => (
                <button
                  type="button"
                  onClick={() => setKind(k)}
                  class={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors border ${
                    kind() === k
                      ? kindActiveClass(k)
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                  }`}
                >
                  {k}
                </button>
              )}
            </For>
          </div>
          <div class="flex gap-1 items-center">
            <span class="text-xs text-slate-500 mr-1">Scope:</span>
            <For each={SCOPES}>
              {(s) => (
                <button
                  type="button"
                  onClick={() => setScope(s)}
                  class={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors border ${
                    scope() === s
                      ? 'bg-kick-500/20 text-kick-500 border-kick-500/30'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                  }`}
                >
                  {s}
                </button>
              )}
            </For>
          </div>
        </div>
      </div>

      {/* Table */}
      <Show
        when={pager.page().length > 0}
        fallback={
          <div class="empty">
            {search() || kind() !== 'ALL' || scope() !== 'ALL'
              ? 'No tokens match the current filter'
              : 'No DI registrations'}
          </div>
        }
      >
        <div class="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th class="w-6" aria-label="expand" />
                <th>Token</th>
                <th>Kind</th>
                <th>Scope</th>
                <th>Status</th>
                <th class="text-right">
                  Resolves
                  <InfoTip metric="resolve.count" placement="bottom" />
                </th>
                <th class="text-right">Deps</th>
              </tr>
            </thead>
            <tbody>
              <For each={pager.page()}>
                {(r) => (
                  <>
                    <tr
                      class="cursor-pointer select-none"
                      onClick={() => toggleRow(r.token)}
                    >
                      <td>
                        <svg
                          class={`w-3 h-3 text-slate-500 transition-transform ${
                            expanded().has(r.token) ? 'rotate-90' : ''
                          }`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                      </td>
                      <td class="font-mono text-sm">{r.token}</td>
                      <td>
                        <span class={`px-2 py-0.5 rounded text-xs font-semibold ${kindBadge(r.kind)}`}>
                          {r.kind ?? 'unknown'}
                        </span>
                      </td>
                      <td>
                        <span class="bg-slate-700/50 text-slate-300 px-2 py-0.5 rounded text-xs font-semibold">
                          {r.scope ?? '—'}
                        </span>
                      </td>
                      <td>
                        <span class={`px-2 py-0.5 rounded text-xs font-semibold ${statusBadge(r)}`}>
                          {statusLabel(r)}
                        </span>
                      </td>
                      <td class="text-right tabular-nums">{r.resolveCount ?? 0}</td>
                      <td class="text-right text-slate-500 text-xs">
                        {r.dependencies?.length ?? 0}
                      </td>
                    </tr>
                    <Show when={expanded().has(r.token)}>
                      <tr>
                        <td colspan={7} class="bg-slate-800/30 px-6 py-4 border-b border-slate-800">
                          <ExpandedDetail registration={r} />
                        </td>
                      </tr>
                    </Show>
                  </>
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

/** Inline panel shown inside an expanded row — deps, resolve stats, PostConstruct. */
const ExpandedDetail: Component<{ registration: ContainerRegistration }> = (props) => {
  return (
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <h4 class="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
          Dependencies
        </h4>
        <Show
          when={(props.registration.dependencies?.length ?? 0) > 0}
          fallback={<span class="text-slate-600 text-sm">None</span>}
        >
          <div class="flex flex-wrap gap-1">
            <For each={props.registration.dependencies}>
              {(dep) => (
                <button
                  type="button"
                  class="bg-slate-700/50 text-kick-500 hover:bg-slate-700 px-2 py-0.5 rounded text-xs font-mono transition-colors"
                  onClick={(e) => {
                    e.stopPropagation()
                    openDetailModal(dep)
                  }}
                  title={`Open detail for ${dep}`}
                >
                  {dep}
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
      <div>
        <h4 class="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
          Resolve Stats
        </h4>
        <div class="space-y-1 text-sm">
          <div class="flex justify-between">
            <span class="text-slate-400">Resolve count</span>
            <span class="tabular-nums">{props.registration.resolveCount ?? 0}</span>
          </div>
          <Show when={props.registration.firstResolved}>
            {(ts) => (
              <div class="flex justify-between">
                <span class="text-slate-400">First resolved</span>
                <span class="text-xs">{new Date(ts()).toLocaleTimeString()}</span>
              </div>
            )}
          </Show>
          <Show when={props.registration.lastResolved}>
            {(ts) => (
              <div class="flex justify-between">
                <span class="text-slate-400">Last resolved</span>
                <span class="text-xs">{new Date(ts()).toLocaleTimeString()}</span>
              </div>
            )}
          </Show>
          <Show when={props.registration.resolveDurationMs != null}>
            <div class="flex justify-between">
              <span class="text-slate-400">Duration</span>
              <span class="tabular-nums">
                {(props.registration.resolveDurationMs ?? 0).toFixed(2)}ms
              </span>
            </div>
          </Show>
        </div>
      </div>
      <div>
        <h4 class="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
          PostConstruct
          <InfoTip metric="post-construct" />
        </h4>
        <span class={`px-2 py-0.5 rounded text-xs font-semibold ${postConstructBadge(
          props.registration.postConstructStatus,
        )}`}>
          {props.registration.postConstructStatus ?? 'none'}
        </span>
      </div>
      <div class="md:col-span-2 flex justify-end">
        <button
          type="button"
          class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-kick-500/20 text-kick-500 border border-kick-500/30 hover:bg-kick-500/30 transition-colors"
          onClick={(e) => {
            e.stopPropagation()
            openDetailModal(props.registration.token)
          }}
        >
          View full details
        </button>
      </div>
    </div>
  )
}

function kindBadge(kind: string | undefined): string {
  if (kind === 'controller') return 'bg-violet-900/50 text-violet-300'
  if (kind === 'service') return 'bg-blue-900/50 text-blue-300'
  if (kind === 'repository') return 'bg-teal-900/50 text-teal-300'
  return 'bg-slate-700/50 text-slate-300'
}

function kindActiveClass(k: KindFilter): string {
  if (k === 'controller') return 'bg-violet-900/50 text-violet-300 border-violet-700/50'
  if (k === 'service') return 'bg-blue-900/50 text-blue-300 border-blue-700/50'
  if (k === 'repository') return 'bg-teal-900/50 text-teal-300 border-teal-700/50'
  if (k === 'other') return 'bg-slate-700/50 text-slate-300 border-slate-600/50'
  return 'bg-kick-500/20 text-kick-500 border-kick-500/30'
}

function statusBadge(r: ContainerRegistration): string {
  if (r.postConstructStatus === 'failed') return 'bg-red-900/50 text-red-300'
  if (r.instantiated) return 'bg-emerald-900/50 text-emerald-300'
  return 'bg-amber-900/50 text-amber-300'
}

function statusLabel(r: ContainerRegistration): string {
  if (r.postConstructStatus === 'failed') return 'failed'
  if (r.instantiated) return 'active'
  return 'registered'
}

function postConstructBadge(status: string | undefined): string {
  if (status === 'done') return 'bg-emerald-900/50 text-emerald-300'
  if (status === 'failed') return 'bg-red-900/50 text-red-300'
  return 'bg-slate-700/50 text-slate-400'
}
