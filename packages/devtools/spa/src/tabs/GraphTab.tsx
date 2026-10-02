/**
 * Graph — the DI dependency graph, laid out in columns from what nothing
 * depends on (controllers, usually) to leaves. Selecting a token keeps its
 * dependents and dependencies (all the way down) in focus, dims the rest,
 * and shows its details beside the graph. Edges that close a cycle are red.
 */

import { createMemo, createSignal, For, Show, type Component } from 'solid-js'
import { store } from '../lib/store'
import { kindTone } from '../lib/format'
import { SplitPane } from '../lib/split-pane'
import { TokenDetail } from '../lib/token-detail'
import { edgeKey, layoutGraph } from '../lib/graph-layout'

const NODE_W = 164
const NODE_H = 26
const COL_GAP = 56
const ROW_GAP = 10
const PAD = 12

const KIND_COLOURS: Record<string, string> = {
  controller: '#8b5cf6',
  service: '#3b82f6',
  repository: '#14b8a6',
}

export const GraphTab: Component = () => {
  const [selected, setSelected] = createSignal<string | null>(null)
  const [search, setSearch] = createSignal('')

  const nodes = createMemo(() => store.container())
  const byId = createMemo(() => new Map(nodes().map((n) => [n.token, n])))
  const edges = createMemo(() =>
    nodes().flatMap((n) =>
      (n.dependencies ?? []).filter((d) => byId().has(d)).map((d) => ({ from: n.token, to: d })),
    ),
  )
  const layout = createMemo(() =>
    layoutGraph(
      nodes().map((n) => n.token),
      edges(),
    ),
  )
  const position = createMemo(() => {
    const pos = new Map<string, { x: number; y: number }>()
    layout().layers.forEach((col, i) =>
      col.forEach((id, j) =>
        pos.set(id, { x: PAD + i * (NODE_W + COL_GAP), y: PAD + j * (NODE_H + ROW_GAP) }),
      ),
    )
    return pos
  })
  const size = createMemo(() => ({
    w: PAD * 2 + Math.max(1, layout().layers.length) * (NODE_W + COL_GAP) - COL_GAP,
    h:
      PAD * 2 + Math.max(1, ...layout().layers.map((c) => c.length)) * (NODE_H + ROW_GAP) - ROW_GAP,
  }))

  /** The selected node, everything it depends on, and everything that depends on it. */
  const focus = createMemo<Set<string> | null>(() => {
    const s = selected()
    if (!s) return null
    const walk = (start: string, next: (id: string) => string[]): Set<string> => {
      const seen = new Set<string>([start])
      const stack = [start]
      while (stack.length) {
        for (const m of next(stack.pop()!)) {
          if (seen.has(m)) continue
          seen.add(m)
          stack.push(m)
        }
      }
      return seen
    }
    const down = walk(s, (id) =>
      edges()
        .filter((e) => e.from === id)
        .map((e) => e.to),
    )
    const up = walk(s, (id) =>
      edges()
        .filter((e) => e.to === id)
        .map((e) => e.from),
    )
    return new Set([...down, ...up])
  })
  const dimmed = (id: string): boolean => !!focus() && !focus()!.has(id)

  const jump = (): void => {
    const q = search().trim().toLowerCase()
    const hit = q && nodes().find((n) => n.token.toLowerCase().includes(q))
    if (hit) setSelected(hit.token)
  }

  const edgePath = (from: string, to: string): string => {
    const a = position().get(from)!
    const b = position().get(to)!
    const x1 = a.x + NODE_W
    const y1 = a.y + NODE_H / 2
    const x2 = b.x
    const y2 = b.y + NODE_H / 2
    const bend = Math.max(30, Math.abs(x2 - x1) / 2)
    return `M${x1} ${y1} C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}`
  }

  const graph = (
    <div class="flex h-full flex-col">
      <div class="flex flex-wrap items-center gap-2 border-b border-border p-2">
        <input
          type="text"
          placeholder="Find a token — Enter to select"
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && jump()}
          class="w-60 bg-surface-2 border border-border-strong rounded-lg px-3 py-1 text-sm text-text-body placeholder:text-text-muted focus:outline-none focus:border-kick-500"
        />
        <For each={Object.entries(KIND_COLOURS)}>
          {([kind, colour]) => (
            <span class="flex items-center gap-1 text-xs text-text-muted">
              <span class="h-2 w-2 rounded-sm" style={{ background: colour }} />
              {kind}
            </span>
          )}
        </For>
        <Show when={layout().cycleEdges.size > 0}>
          <span class="flex items-center gap-1 text-xs text-red-500">
            <span class="h-0.5 w-3 bg-red-500" /> cycle
          </span>
        </Show>
        <span class="flex-1" />
        <Show when={selected()}>
          <button
            type="button"
            class="text-xs text-text-muted hover:text-text-strong"
            onClick={() => setSelected(null)}
          >
            Clear focus
          </button>
        </Show>
      </div>
      <div class="dt-panel-grid min-h-0 flex-1 overflow-auto !block !p-0">
        <Show
          when={layout().layers.length > 0}
          fallback={
            <div class="p-6 text-sm text-text-muted">
              No dependencies between registered tokens yet.
            </div>
          }
        >
          <svg width={size().w} height={size().h} class="block">
            <defs>
              <marker
                id="dt-arrow"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="6"
                markerHeight="6"
                orient="auto"
              >
                <path d="M0 0 L8 4 L0 8 z" fill="var(--color-text-muted)" />
              </marker>
            </defs>
            <For each={edges()}>
              {(e) => {
                const cyc = () => layout().cycleEdges.has(edgeKey(e.from, e.to))
                return (
                  <path
                    d={edgePath(e.from, e.to)}
                    fill="none"
                    stroke={cyc() ? '#ef4444' : 'var(--color-border-strong)'}
                    stroke-width={selected() === e.from || selected() === e.to ? 2 : 1.25}
                    stroke-dasharray={cyc() ? '4 3' : undefined}
                    marker-end="url(#dt-arrow)"
                    opacity={dimmed(e.from) || dimmed(e.to) ? 0.15 : 1}
                  />
                )
              }}
            </For>
            <For each={layout().layers.flat()}>
              {(id) => {
                const p = () => position().get(id)!
                const kind = () => byId().get(id)?.kind ?? ''
                return (
                  <g
                    transform={`translate(${p().x} ${p().y})`}
                    class="cursor-pointer"
                    opacity={dimmed(id) ? 0.25 : 1}
                    onClick={() => setSelected((s) => (s === id ? null : id))}
                  >
                    <title>{id}</title>
                    <rect
                      width={NODE_W}
                      height={NODE_H}
                      rx="5"
                      fill="var(--color-surface-1)"
                      stroke={
                        selected() === id ? 'var(--color-accent)' : 'var(--color-border-strong)'
                      }
                      stroke-width={selected() === id ? 2 : 1}
                    />
                    <rect
                      width="4"
                      height={NODE_H}
                      rx="2"
                      fill={KIND_COLOURS[kind()] ?? 'var(--color-text-muted)'}
                    />
                    <text
                      x="12"
                      y={NODE_H / 2 + 4}
                      font-size="11.5"
                      font-family="var(--font-mono)"
                      fill="var(--color-text-body)"
                    >
                      {id.length > 22 ? `${id.slice(0, 21)}…` : id}
                    </text>
                  </g>
                )
              }}
            </For>
          </svg>
        </Show>
        <Show when={layout().isolated.length > 0}>
          <div class="border-t border-border p-3">
            <div class="mb-1.5 text-[0.66rem] font-semibold uppercase tracking-wider text-text-muted">
              No dependencies either way ({layout().isolated.length})
            </div>
            <div class="flex flex-wrap gap-1">
              <For each={layout().isolated}>
                {(id) => (
                  <button
                    type="button"
                    class={`${kindTone(byId().get(id)?.kind)} font-mono ${selected() === id ? 'ring-1 ring-kick-500' : ''}`}
                    onClick={() => setSelected(id)}
                  >
                    {id}
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>
      </div>
    </div>
  )

  const detail = (
    <Show
      when={selected()}
      fallback={
        <div class="dt-panel-grid">
          <div class="card text-sm text-text-muted">Select a token to trace its dependencies</div>
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

  return <SplitPane storageKey="graph" defaultLeft={720} left={graph} right={detail} />
}
