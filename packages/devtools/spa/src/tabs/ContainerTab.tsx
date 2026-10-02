/**
 * Container — every DI registration, searchable and filterable by kind and
 * scope (each chip shows how many match), with the selected token's details
 * beside the list. Reads `store.container()`.
 */

import { createMemo, createSignal, For, Show, type Component } from 'solid-js'
import { store, type ContainerRegistration } from '../lib/store'
import { ago, kindTone } from '../lib/format'
import { SplitPane } from '../lib/split-pane'
import { TokenDetail, takePendingToken, tokenStatus } from '../lib/token-detail'

const KINDS = ['controller', 'service', 'repository'] as const
const kindOf = (r: ContainerRegistration): string =>
  (KINDS as readonly string[]).includes(r.kind ?? '') ? r.kind! : 'other'

export const ContainerTab: Component = () => {
  const [search, setSearch] = createSignal('')
  const [kind, setKind] = createSignal<string | null>(null)
  const [scope, setScope] = createSignal<string | null>(null)
  const [selected, setSelected] = createSignal<string | null>(takePendingToken())

  const matchesSearch = createMemo(() => {
    const q = search().trim().toLowerCase()
    return store.container().filter((r) => !q || r.token.toLowerCase().includes(q))
  })
  const counts = (pick: (r: ContainerRegistration) => string, rows: ContainerRegistration[]) => {
    const out = new Map<string, number>()
    for (const r of rows) out.set(pick(r), (out.get(pick(r)) ?? 0) + 1)
    return out
  }
  // Each facet counts within the other facet's selection, so a chip's number
  // is what you'd get by clicking it.
  const kindCounts = createMemo(() =>
    counts(
      kindOf,
      matchesSearch().filter((r) => !scope() || (r.scope ?? 'singleton') === scope()),
    ),
  )
  const scopeCounts = createMemo(() =>
    counts(
      (r) => r.scope ?? 'singleton',
      matchesSearch().filter((r) => !kind() || kindOf(r) === kind()),
    ),
  )
  const rows = createMemo(() =>
    matchesSearch()
      .filter(
        (r) =>
          (!kind() || kindOf(r) === kind()) && (!scope() || (r.scope ?? 'singleton') === scope()),
      )
      .toSorted(
        (a, b) => (b.resolveCount ?? 0) - (a.resolveCount ?? 0) || a.token.localeCompare(b.token),
      ),
  )

  const chip = (label: string, count: number | undefined, active: boolean, onClick: () => void) => (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      class={`rounded-md border px-2 py-0.5 text-[0.68rem] font-semibold ${
        active
          ? 'border-kick-500/30 bg-kick-500/20 text-kick-500'
          : 'border-border-strong bg-surface-2 text-text-secondary hover:text-text-body'
      }`}
    >
      {label} <span class="font-normal opacity-70">{count ?? 0}</span>
    </button>
  )

  const list = (
    <>
      <div class="flex flex-col gap-1.5 border-b border-border p-2">
        <input
          type="text"
          placeholder="Search tokens…"
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
          class="w-full bg-surface-2 border border-border-strong rounded-lg px-3 py-1.5 text-sm text-text-body placeholder:text-text-muted focus:outline-none focus:border-kick-500"
        />
        <div class="flex flex-wrap items-center gap-1">
          <For each={[...KINDS, 'other']}>
            {(k) =>
              chip(k, kindCounts().get(k), kind() === k, () => setKind((v) => (v === k ? null : k)))
            }
          </For>
          <span class="mx-1 h-4 w-px bg-border" />
          <For each={['singleton', 'transient', 'request']}>
            {(s) =>
              chip(s, scopeCounts().get(s), scope() === s, () =>
                setScope((v) => (v === s ? null : s)),
              )
            }
          </For>
        </div>
        <div class="text-xs text-text-muted">
          <Show when={rows().length !== store.container().length}>{rows().length} matched · </Show>
          {store.container().length} tokens
        </div>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <Show
          when={rows().length > 0}
          fallback={
            <div class="empty">
              {store.container().length ? 'No tokens match' : 'Nothing registered yet'}
            </div>
          }
        >
          <For each={rows()}>
            {(r) => (
              <button
                type="button"
                class={`flex w-full cursor-pointer items-center gap-2 border-0 border-b border-border/50 px-2.5 py-1 text-left text-[0.78rem] text-text-body ${
                  selected() === r.token
                    ? 'bg-accent/12 shadow-[inset_2px_0_0_0_var(--color-accent)]'
                    : 'bg-transparent hover:bg-surface-hover'
                }`}
                onClick={() => setSelected(r.token)}
              >
                <span
                  class={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    tokenStatus(r).label === 'failed'
                      ? 'bg-red-500'
                      : r.instantiated
                        ? 'bg-emerald-500'
                        : 'bg-border-strong'
                  }`}
                  title={tokenStatus(r).label}
                />
                <span class="min-w-0 flex-1 truncate font-mono">{r.token}</span>
                <span class={kindTone(r.kind)}>{kindOf(r)}</span>
                <Show when={(r.scope ?? 'singleton') !== 'singleton'}>
                  <span class="dt-tone dt-tone-gray">{r.scope}</span>
                </Show>
                <span class="w-10 shrink-0 text-right text-[0.7rem] text-text-muted tabular-nums">
                  {r.resolveCount ?? 0}×
                </span>
                <span class="w-14 shrink-0 text-right text-[0.66rem] text-text-muted">
                  {r.lastResolvedAt ? ago(r.lastResolvedAt) : '—'}
                </span>
              </button>
            )}
          </For>
        </Show>
      </div>
    </>
  )

  const detail = (
    <Show
      when={selected()}
      fallback={
        <div class="dt-panel-grid">
          <div class="card text-sm text-text-muted">Select a token to see its dependencies</div>
        </div>
      }
    >
      {(t) => (
        <div class="h-full overflow-y-auto bg-surface-1">
          <TokenDetail token={t()} onSelect={setSelected} />
        </div>
      )}
    </Show>
  )

  return <SplitPane storageKey="container" left={list} right={detail} />
}
