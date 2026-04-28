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
import { Pagination, usePagination } from '../lib/pagination'

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
    <div class="bg-surface-1 rounded-xl border border-border p-5">
      {/* Search */}
      <div class="relative mb-4">
        <svg
          class="absolute left-3 top-2.5 w-4 h-4 text-text-muted"
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
          class="w-full bg-surface-2 border border-border-strong rounded-lg pl-10 pr-4 py-2 text-sm
                 text-text-body placeholder:text-text-muted focus:outline-none focus:border-kick-500"
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
  // Each group runs its own pager — controllers, services, etc. all
  // grow independently in real apps, so paging them in lockstep would
  // overflow one section while another is empty. 25/page matches the
  // Topology DI tokens table.
  const source = createMemo(() => props.nodes ?? [])
  const pager = usePagination(source, { pageSize: 25 })

  // Collapsible — user toggles by clicking the section header. State
  // persists per-group in localStorage so reloads remember which
  // sections the user collapsed (typical use: collapse controllers
  // when debugging a service-layer graph). Default open.
  const storageKey = `kickjs-devtools-graph-collapsed-${props.label}`
  const readPersisted = (): boolean => {
    try {
      return localStorage.getItem(storageKey) === '1'
    } catch {
      return false
    }
  }
  const [collapsed, setCollapsed] = createSignal(readPersisted())
  const toggle = (): void => {
    const next = !collapsed()
    setCollapsed(next)
    try {
      if (next) localStorage.setItem(storageKey, '1')
      else localStorage.removeItem(storageKey)
    } catch {
      // localStorage unavailable — toggle still works in-memory.
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed()}
        class={`w-full flex items-center text-left text-xs font-semibold uppercase tracking-wider mb-2 ${labelColor(props.label)} cursor-pointer hover:opacity-80 transition-opacity`}
      >
        <svg
          class={`w-3 h-3 mr-1.5 transition-transform ${collapsed() ? '' : 'rotate-90'}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7" />
        </svg>
        <span>{props.label}</span>
        <span class="ml-2 text-text-muted font-normal normal-case">({source().length})</span>
      </button>
      <Show when={!collapsed()}>
        <div class="space-y-1">
          <For each={pager.page()}>{(node) => <NodeRow node={node} />}</For>
        </div>
        <Show when={source().length > 25}>
          <Pagination pager={pager} />
        </Show>
      </Show>
    </div>
  )
}

const NodeRow: Component<{ node: ContainerRegistration }> = (props) => {
  const deps = (): string[] => props.node.dependencies ?? []
  return (
    <button
      type="button"
      class="w-full text-left px-3 py-2 rounded-lg hover:bg-surface-2/50 transition-colors group"
      onClick={() => openDetailModal(props.node.token)}
    >
      <div class="flex items-center gap-2">
        <span class={`px-2 py-0.5 rounded text-xs font-semibold ${kindBadge(props.node.kind)}`}>
          {kindShort(props.node.kind)}
        </span>
        <span class="font-mono text-sm text-text-body break-all">{props.node.token}</span>
        <Show when={props.node.scope}>
          <span class="bg-border-strong/50 text-text-secondary px-1.5 py-0.5 rounded text-xs">
            {props.node.scope}
          </span>
        </Show>
        <Show when={(props.node.resolveCount ?? 0) > 0}>
          <span class="text-text-muted text-xs ml-auto tabular-nums">
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
                class="flex items-center gap-2 text-xs text-text-muted hover:text-text-strong"
                onClick={(e) => {
                  e.stopPropagation()
                  openDetailModal(dep)
                }}
              >
                <svg
                  class="w-3 h-3 text-text-muted"
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
  return 'bg-border-strong/50 text-text-strong'
}

function labelColor(label: string): string {
  if (label === 'Controllers') return 'text-violet-400'
  if (label === 'Services') return 'text-blue-400'
  if (label === 'Repositories') return 'text-teal-400'
  return 'text-text-secondary'
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
