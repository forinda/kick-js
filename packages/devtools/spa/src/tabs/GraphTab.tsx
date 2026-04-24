/**
 * Dependency graph tab — DI registrations grouped by kind, with each
 * node showing its outgoing edges (dependencies) inline. Every node
 * + every edge target is clickable to open the DetailModal.
 *
 * Recovers the legacy Vue dashboard's Graph tab. Sources data from
 * store.container() (the unified /stream consumer) rather than its
 * own /graph endpoint call — the container snapshot already carries
 * kind/scope/resolveCount/dependencies, so a separate endpoint
 * doesn't add information.
 */

import { createMemo, createSignal, For, Show, type Component } from 'solid-js'
import { store, type ContainerRegistration } from '../lib/store'
import { openDetailModal } from '../lib/detail-modal'

const KIND_GROUPS = [
  { id: 'controllers', label: 'Controllers', match: (k?: string) => k === 'controller' },
  { id: 'services', label: 'Services', match: (k?: string) => k === 'service' },
  { id: 'repositories', label: 'Repositories', match: (k?: string) => k === 'repository' },
  {
    id: 'other',
    label: 'Other',
    match: (k?: string) => !['controller', 'service', 'repository'].includes(k ?? ''),
  },
] as const

export const GraphTab: Component = () => {
  const [search, setSearch] = createSignal('')

  const filtered = createMemo<ContainerRegistration[]>(() => {
    const all = store.container()
    const q = search().trim().toLowerCase()
    if (!q) return all
    return all.filter(
      (r) => r.token.toLowerCase().includes(q) || (r.kind ?? '').toLowerCase().includes(q),
    )
  })

  const grouped = createMemo(() =>
    KIND_GROUPS.map((g) => ({
      ...g,
      nodes: filtered().filter((r) => g.match(r.kind)),
    })),
  )

  return (
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
          placeholder="Filter graph (token or kind)…"
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
          class="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-sm
                 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-kick-500"
        />
      </div>

      <Show
        when={filtered().length > 0}
        fallback={
          <div class="empty">
            {search() ? 'No nodes match the filter' : 'No DI registrations to graph'}
          </div>
        }
      >
        <div class="space-y-6">
          <For each={grouped()}>
            {(group) => (
              <Show when={group.nodes.length > 0}>
                <GroupSection label={group.label} nodes={group.nodes} />
              </Show>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

const GroupSection: Component<{ label: string; nodes: ContainerRegistration[] }> = (props) => {
  return (
    <div>
      <h3 class={`text-xs font-semibold uppercase tracking-wider mb-2 ${labelColor(props.label)}`}>
        {props.label}
        <span class="ml-2 text-slate-600 font-normal normal-case">
          ({props.nodes.length})
        </span>
      </h3>
      <div class="space-y-1">
        <For each={props.nodes}>{(node) => <NodeRow node={node} />}</For>
      </div>
    </div>
  )
}

const NodeRow: Component<{ node: ContainerRegistration }> = (props) => {
  const deps = (): string[] => props.node.dependencies ?? []
  return (
    <button
      type="button"
      class="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-800/50 transition-colors group"
      onClick={() => openDetailModal(props.node.token)}
    >
      <div class="flex items-center gap-2">
        <span class={`px-2 py-0.5 rounded text-xs font-semibold ${kindBadge(props.node.kind)}`}>
          {kindShort(props.node.kind)}
        </span>
        <span class="font-mono text-sm text-slate-200 break-all">{props.node.token}</span>
        <Show when={props.node.scope}>
          <span class="bg-slate-700/50 text-slate-400 px-1.5 py-0.5 rounded text-xs">
            {props.node.scope}
          </span>
        </Show>
        <Show when={(props.node.resolveCount ?? 0) > 0}>
          <span class="text-slate-600 text-xs ml-auto tabular-nums">
            {props.node.resolveCount} resolves
          </span>
        </Show>
      </div>
      {/* Outgoing edges */}
      <Show when={deps().length > 0}>
        <div class="ml-8 mt-1 space-y-0.5">
          <For each={deps()}>
            {(dep) => (
              <div
                class="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300"
                onClick={(e) => {
                  e.stopPropagation()
                  openDetailModal(dep)
                }}
              >
                <svg
                  class="w-3 h-3 text-slate-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M13 7l5 5-5 5M6 12h12"
                  />
                </svg>
                <span class={`px-1.5 py-0.5 rounded text-xs font-semibold ${edgeTargetBadge(dep)}`}>
                  {edgeTargetKindShort(dep)}
                </span>
                <span class="font-mono">{dep}</span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </button>
  )
}

function kindShort(kind: string | undefined): string {
  if (kind === 'controller') return 'ctrl'
  if (kind === 'service') return 'svc'
  if (kind === 'repository') return 'repo'
  return 'other'
}

function kindBadge(kind: string | undefined): string {
  if (kind === 'controller') return 'bg-violet-900/50 text-violet-300'
  if (kind === 'service') return 'bg-blue-900/50 text-blue-300'
  if (kind === 'repository') return 'bg-teal-900/50 text-teal-300'
  return 'bg-slate-700/50 text-slate-300'
}

function labelColor(label: string): string {
  if (label === 'Controllers') return 'text-violet-400'
  if (label === 'Services') return 'text-blue-400'
  if (label === 'Repositories') return 'text-teal-400'
  return 'text-slate-400'
}

/**
 * Look up the kind for an edge target by re-reading the store.
 * Done lazily inside the badge helpers so the badge stays accurate
 * if the snapshot changes (live SSE update). Edge targets that
 * resolve outside the snapshot (peer adapters, missing) get the
 * neutral "other" badge.
 */
function edgeTargetKindShort(token: string): string {
  return kindShort(store.container().find((r) => r.token === token)?.kind)
}

function edgeTargetBadge(token: string): string {
  return kindBadge(store.container().find((r) => r.token === token)?.kind)
}
