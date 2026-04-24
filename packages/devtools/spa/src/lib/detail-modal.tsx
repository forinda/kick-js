/**
 * Token detail modal — drilldown for any DI registration.
 *
 * Recovers the legacy Vue dashboard's modal for "click a token,
 * see everything we know about it":
 *
 *   - Header: token literal + kind / scope / status badges.
 *   - Dependencies list (chips) — click to navigate to that
 *     dependency's modal in place.
 *   - Dependents list — every other registration that lists this
 *     token in its `dependencies` array. Click to navigate.
 *   - Resolve stats — count, first/last resolve timestamps,
 *     resolution duration.
 *   - PostConstruct status badge.
 *
 * Click-through navigation between dependencies is the killer
 * feature: trace the dependency graph from any starting node
 * without leaving the modal. Stack of "back" history kept so
 * Esc / outside-click closes the whole modal but the in-modal
 * back arrow pops one level.
 */

import { createMemo, createSignal, For, Show, type Component } from 'solid-js'
import { store, type ContainerRegistration } from './store'

const [activeToken, setActiveToken] = createSignal<string | null>(null)
const [historyStack, setHistoryStack] = createSignal<string[]>([])

/** Open the modal anchored to a specific token. */
export function openDetailModal(token: string): void {
  // First open from a non-modal context — clear history.
  setHistoryStack([])
  setActiveToken(token)
}

/** Navigate from inside an open modal to a different token (push history). */
export function navigateModalTo(token: string): void {
  const current = activeToken()
  if (current && current !== token) {
    setHistoryStack((prev) => [...prev, current])
  }
  setActiveToken(token)
}

/** Pop one history entry; closes the modal if the stack is empty. */
function back(): void {
  setHistoryStack((prev) => {
    if (prev.length === 0) {
      setActiveToken(null)
      return prev
    }
    const next = prev.slice(0, -1)
    setActiveToken(prev[prev.length - 1])
    return next
  })
}

/** Close the modal entirely + clear history. */
function close(): void {
  setActiveToken(null)
  setHistoryStack([])
}

/**
 * Modal host — renders nothing when no token is active. Mount once
 * in App.tsx; tab code calls `openDetailModal(token)` to summon it.
 */
export const DetailModalHost: Component = () => {
  // Looks up the registration for the active token. Returns a stub
  // when the token isn't in the container registry (e.g. the user
  // clicked a dependency that resolves from a peer adapter not in
  // the snapshot). Modal still renders so navigation works.
  const registration = createMemo<ContainerRegistration | null>(() => {
    const token = activeToken()
    if (!token) return null
    const reg = store.container().find((r) => r.token === token)
    if (reg) return reg
    return { token, kind: undefined, scope: undefined, dependencies: [] }
  })

  // Reverse-edge lookup — every registration that lists the active
  // token in its dependencies. Drives the "Dependents" panel.
  const dependents = createMemo<string[]>(() => {
    const token = activeToken()
    if (!token) return []
    return store
      .container()
      .filter((r) => r.dependencies?.includes(token))
      .map((r) => r.token)
  })

  return (
    <Show when={registration()}>
      {(reg) => (
        <div
          class="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) close()
          }}
        >
          <div class="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-2xl w-full shadow-2xl max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div class="flex items-start justify-between mb-4">
              <div>
                <div class="flex items-center gap-2 mb-1">
                  <Show when={historyStack().length > 0}>
                    <button
                      type="button"
                      class="text-slate-500 hover:text-slate-300 p-1"
                      aria-label="Back"
                      onClick={back}
                    >
                      <svg
                        class="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M15 19l-7-7 7-7"
                        />
                      </svg>
                    </button>
                  </Show>
                  <h2 class="text-base font-semibold font-mono text-slate-200 break-all">
                    {reg().token}
                  </h2>
                </div>
                <div class="flex flex-wrap gap-2 mt-2">
                  <span class={`px-2 py-0.5 rounded text-xs font-semibold ${kindBadge(reg().kind)}`}>
                    {reg().kind ?? 'unknown'}
                  </span>
                  <span class="bg-slate-700/50 text-slate-300 px-2 py-0.5 rounded text-xs font-semibold">
                    {reg().scope ?? 'singleton'}
                  </span>
                  <span class={`px-2 py-0.5 rounded text-xs font-semibold ${statusBadge(reg())}`}>
                    {statusLabel(reg())}
                  </span>
                </div>
              </div>
              <button
                type="button"
                class="text-slate-500 hover:text-slate-300 p-1"
                aria-label="Close"
                onClick={close}
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {/* Dependencies (outgoing edges) */}
            <Section title="Dependencies">
              <Show
                when={(reg().dependencies?.length ?? 0) > 0}
                fallback={<span class="text-slate-600 text-sm">None</span>}
              >
                <div class="flex flex-wrap gap-1">
                  <For each={reg().dependencies}>
                    {(dep) => (
                      <button
                        type="button"
                        class="bg-slate-800 text-kick-500 hover:bg-slate-700 px-2.5 py-1 rounded text-xs font-mono border border-slate-700 transition-colors"
                        onClick={() => navigateModalTo(dep)}
                      >
                        {dep}
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </Section>

            {/* Dependents (incoming edges) */}
            <Section title="Dependents">
              <Show
                when={dependents().length > 0}
                fallback={<span class="text-slate-600 text-sm">None</span>}
              >
                <div class="flex flex-wrap gap-1">
                  <For each={dependents()}>
                    {(d) => (
                      <button
                        type="button"
                        class="bg-slate-800 text-amber-400 hover:bg-slate-700 px-2.5 py-1 rounded text-xs font-mono border border-slate-700 transition-colors"
                        onClick={() => navigateModalTo(d)}
                      >
                        {d}
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </Section>

            {/* Resolve stats */}
            <Section title="Resolve stats">
              <div class="bg-slate-800/50 rounded-lg border border-slate-700 p-3 space-y-2 text-sm">
                <Row label="Resolve count" value={String(reg().resolveCount ?? 0)} />
                <Show when={reg().firstResolved}>
                  {(ts) => <Row label="First resolved" value={new Date(ts()).toLocaleString()} />}
                </Show>
                <Show when={reg().lastResolved}>
                  {(ts) => <Row label="Last resolved" value={new Date(ts()).toLocaleString()} />}
                </Show>
                <Show when={reg().resolveDurationMs != null}>
                  <Row
                    label="Resolution duration"
                    value={`${(reg().resolveDurationMs ?? 0).toFixed(2)} ms`}
                  />
                </Show>
              </div>
            </Section>

            {/* PostConstruct */}
            <Section title="PostConstruct">
              <span class={`px-2 py-0.5 rounded text-xs font-semibold ${postConstructBadge(reg().postConstructStatus)}`}>
                {reg().postConstructStatus ?? 'none'}
              </span>
            </Section>
          </div>
        </div>
      )}
    </Show>
  )
}

const Section: Component<{ title: string; children: unknown }> = (props) => (
  <div class="mb-4">
    <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
      {props.title}
    </h3>
    {props.children as unknown as Element}
  </div>
)

const Row: Component<{ label: string; value: string }> = (props) => (
  <div class="flex justify-between">
    <span class="text-slate-400">{props.label}</span>
    <span class="tabular-nums">{props.value}</span>
  </div>
)

function kindBadge(kind: string | undefined): string {
  if (kind === 'controller') return 'bg-violet-900/50 text-violet-300'
  if (kind === 'service') return 'bg-blue-900/50 text-blue-300'
  if (kind === 'repository') return 'bg-teal-900/50 text-teal-300'
  return 'bg-slate-700/50 text-slate-300'
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
