/**
 * Graph — the DI dependency graph on a canvas, laid out in columns from what
 * nothing depends on (controllers, usually) to leaves.
 *
 * Canvas: drag a token to move it (positions are remembered per browser),
 * drag the background or scroll to pan, ⌘/Ctrl + scroll or pinch to zoom.
 * **Fit** frames everything; **Reset layout** drops moved positions.
 *
 * Selecting a token keeps its dependents and dependencies (all the way down)
 * in focus, dims the rest, and shows its details beside the graph. Edges that
 * close a cycle are dashed red.
 */

import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onMount,
  Show,
  type Component,
} from 'solid-js'
import { store } from '../lib/store'
import { kindTone } from '../lib/format'
import { SplitPane } from '../lib/split-pane'
import { TokenDetail } from '../lib/token-detail'
import { edgeKey, layoutGraph } from '../lib/graph-layout'
import { fitView, zoomAt, type View } from '../lib/viewport'

const NODE_W = 164
const NODE_H = 26
const COL_GAP = 56
const ROW_GAP = 10
const MOVED_KEY = 'kickjs-devtools-graph-positions'
/** Pointer travel (px) before a press on a token counts as a drag, not a click. */
const DRAG_SLOP = 3

const KIND_COLOURS: Record<string, string> = {
  controller: '#8b5cf6',
  service: '#3b82f6',
  repository: '#14b8a6',
}

type Point = { x: number; y: number }
type Gesture =
  | { kind: 'pan'; sx: number; sy: number; view: View }
  | { kind: 'node'; id: string; sx: number; sy: number; from: Point; dragged: boolean }

function loadMoved(): Record<string, Point> {
  try {
    return JSON.parse(localStorage.getItem(MOVED_KEY) ?? '{}') as Record<string, Point>
  } catch {
    return {}
  }
}

export const GraphTab: Component = () => {
  const [selected, setSelected] = createSignal<string | null>(null)
  const [search, setSearch] = createSignal('')
  const [moved, setMoved] = createSignal<Record<string, Point>>(loadMoved())
  const [view, setView] = createSignal<View>({ x: 0, y: 0, k: 1 })
  const [panning, setPanning] = createSignal(false)
  let canvas: HTMLDivElement | undefined

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
  /** Auto-layout positions, with anything the user dragged where they left it. */
  const position = createMemo(() => {
    const pos = new Map<string, Point>()
    layout().layers.forEach((col, i) =>
      col.forEach((id, j) =>
        pos.set(id, moved()[id] ?? { x: i * (NODE_W + COL_GAP), y: j * (NODE_H + ROW_GAP) }),
      ),
    )
    return pos
  })

  const fit = (): void => {
    if (!canvas || position().size === 0) return
    const ps = [...position().values()]
    const x = Math.min(...ps.map((p) => p.x))
    const y = Math.min(...ps.map((p) => p.y))
    const box = {
      x,
      y,
      w: Math.max(...ps.map((p) => p.x)) + NODE_W - x,
      h: Math.max(...ps.map((p) => p.y)) + NODE_H - y,
    }
    setView(fitView(box, canvas.clientWidth, canvas.clientHeight))
  }
  // Frame the graph on open, and once it first has nodes.
  onMount(() => requestAnimationFrame(fit))
  createEffect(
    on(
      () => position().size > 0,
      (has, had) => {
        if (has && !had) requestAnimationFrame(fit)
      },
    ),
  )

  const saveMoved = (next: Record<string, Point>): void => {
    setMoved(next)
    try {
      localStorage.setItem(MOVED_KEY, JSON.stringify(next))
    } catch {
      // storage unavailable — positions last for this visit
    }
  }

  // ── Pointer: drag a token, or pan the canvas ─────────────────────────
  let gesture: Gesture | null = null

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return
    const id = (e.target as Element).closest('[data-node]')?.getAttribute('data-node')
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    if (id) {
      const from = position().get(id)!
      gesture = { kind: 'node', id, sx: e.clientX, sy: e.clientY, from, dragged: false }
    } else {
      gesture = { kind: 'pan', sx: e.clientX, sy: e.clientY, view: view() }
      setPanning(true)
    }
  }
  const onPointerMove = (e: PointerEvent): void => {
    const g = gesture
    if (!g) return
    const dx = e.clientX - g.sx
    const dy = e.clientY - g.sy
    if (g.kind === 'pan') {
      setView({ ...g.view, x: g.view.x + dx, y: g.view.y + dy })
      return
    }
    if (!g.dragged && Math.hypot(dx, dy) < DRAG_SLOP) return
    g.dragged = true
    const k = view().k
    setMoved((m) => ({ ...m, [g.id]: { x: g.from.x + dx / k, y: g.from.y + dy / k } }))
  }
  const onPointerUp = (): void => {
    const g = gesture
    gesture = null
    setPanning(false)
    if (g?.kind === 'node') {
      if (g.dragged) saveMoved(moved())
      else setSelected((s) => (s === g.id ? null : g.id))
    } else if (g?.kind === 'pan' && g.view === view()) {
      setSelected(null) // a click on empty canvas clears the focus
    }
  }
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) {
      // Pinch on a trackpad arrives as ctrl + wheel too.
      const r = canvas!.getBoundingClientRect()
      // A mouse notch is ~100; clamp it so one notch is ~1.3×, while a
      // pinch's many small deltas still zoom smoothly.
      const step = Math.max(-50, Math.min(50, e.deltaY))
      setView((v) => zoomAt(v, Math.exp(-step * 0.005), e.clientX - r.left, e.clientY - r.top))
    } else {
      setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
    }
  }
  const zoomBy = (factor: number): void => {
    if (!canvas) return
    setView((v) => zoomAt(v, factor, canvas!.clientWidth / 2, canvas!.clientHeight / 2))
  }

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
    if (!hit) return
    setSelected(hit.token)
    const p = position().get(hit.token)
    if (p && canvas) {
      const k = view().k
      setView({
        k,
        x: canvas.clientWidth / 2 - (p.x + NODE_W / 2) * k,
        y: canvas.clientHeight / 2 - (p.y + NODE_H / 2) * k,
      })
    }
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

  const toolButton =
    'rounded-md border border-border-strong bg-surface-2 px-2 py-0.5 text-xs text-text-secondary hover:text-text-strong'

  const graph = (
    <div class="flex h-full flex-col">
      <div class="flex flex-wrap items-center gap-2 border-b border-border p-2">
        <input
          type="text"
          placeholder="Find a token — Enter to jump"
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && jump()}
          class="w-52 bg-surface-2 border border-border-strong rounded-lg px-3 py-1 text-sm text-text-body placeholder:text-text-muted focus:outline-none focus:border-kick-500"
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
        <button
          type="button"
          class={toolButton}
          onClick={() => zoomBy(1 / 1.25)}
          aria-label="Zoom out"
        >
          −
        </button>
        <span class="w-10 text-center text-xs text-text-muted tabular-nums">
          {Math.round(view().k * 100)}%
        </span>
        <button type="button" class={toolButton} onClick={() => zoomBy(1.25)} aria-label="Zoom in">
          +
        </button>
        <button type="button" class={toolButton} onClick={fit}>
          Fit
        </button>
        <Show when={Object.keys(moved()).length > 0}>
          <button
            type="button"
            class={toolButton}
            onClick={() => {
              saveMoved({})
              requestAnimationFrame(fit)
            }}
          >
            Reset layout
          </button>
        </Show>
      </div>
      <div
        ref={(el) => (canvas = el)}
        class={`relative min-h-0 flex-1 touch-none select-none overflow-hidden ${
          panning() ? 'cursor-grabbing' : 'cursor-grab'
        }`}
        style={{
          'background-image': 'radial-gradient(var(--color-border) 1px, transparent 1px)',
          'background-size': `${16 * view().k}px ${16 * view().k}px`,
          'background-position': `${view().x}px ${view().y}px`,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        <Show
          when={layout().layers.length > 0}
          fallback={
            <div class="p-6 text-sm text-text-muted">
              No dependencies between registered tokens yet.
            </div>
          }
        >
          <svg class="absolute inset-0 h-full w-full">
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
            <g transform={`translate(${view().x} ${view().y}) scale(${view().k})`}>
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
                      data-node={id}
                      transform={`translate(${p().x} ${p().y})`}
                      class="cursor-move"
                      opacity={dimmed(id) ? 0.25 : 1}
                    >
                      <title>{id} — drag to move, click to focus</title>
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
            </g>
          </svg>
        </Show>
        <span class="pointer-events-none absolute bottom-2 left-2 text-[0.62rem] text-text-muted">
          Drag tokens to arrange · drag or scroll to pan · ⌘/Ctrl + scroll to zoom
        </span>
      </div>
      <Show when={layout().isolated.length > 0}>
        <div class="max-h-32 overflow-y-auto border-t border-border p-3">
          <div class="mb-1.5 text-[0.66rem] font-semibold uppercase tracking-wider text-text-muted">
            No dependencies either way ({layout().isolated.length})
          </div>
          <div class="flex flex-wrap gap-1">
            <For each={layout().isolated}>
              {(id) => (
                <button
                  type="button"
                  class={`${kindTone(byId().get(id)?.kind)} font-mono ${
                    selected() === id ? 'ring-1 ring-kick-500' : ''
                  }`}
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
