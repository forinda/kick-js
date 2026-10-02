/**
 * Layered layout for the DI graph — pure, so it's unit-tested.
 *
 * An edge `from → to` means `from` depends on `to`. Columns run left to
 * right from what nothing depends on (usually controllers) to leaves (often
 * repositories). Edges that close a cycle are reported separately and left
 * out of layering, so a cycle can't hang it.
 */

export interface GraphLayout {
  /** Columns of node ids, left to right. */
  layers: string[][]
  /** `"from→to"` keys of edges that close a cycle. */
  cycleEdges: Set<string>
  /** Nodes with no edges at all — listed apart instead of cluttering column 0. */
  isolated: string[]
}

export const edgeKey = (from: string, to: string): string => `${from}→${to}`

export function layoutGraph(
  nodes: readonly string[],
  edges: ReadonlyArray<{ from: string; to: string }>,
): GraphLayout {
  const out = new Map<string, string[]>(nodes.map((n) => [n, []]))
  for (const e of edges) if (out.has(e.from) && out.has(e.to)) out.get(e.from)!.push(e.to)

  // Back edges via DFS: an edge into a node still on the stack closes a cycle.
  const cycleEdges = new Set<string>()
  const state = new Map<string, 'active' | 'done'>()
  const visit = (n: string): void => {
    state.set(n, 'active')
    for (const m of out.get(n)!) {
      if (state.get(m) === 'active') cycleEdges.add(edgeKey(n, m))
      else if (!state.has(m)) visit(m)
    }
    state.set(n, 'done')
  }
  for (const n of nodes) if (!state.has(n)) visit(n)

  const dag = (n: string): string[] => out.get(n)!.filter((m) => !cycleEdges.has(edgeKey(n, m)))
  const linked = new Set<string>()
  for (const [n, ms] of out) {
    if (ms.length) linked.add(n)
    for (const m of ms) linked.add(m)
  }

  // Longest path from a root: a node sits one column right of its deepest dependent.
  const depth = new Map<string, number>()
  const indegree = new Map<string, number>([...linked].map((n) => [n, 0]))
  for (const n of linked) for (const m of dag(n)) indegree.set(m, indegree.get(m)! + 1)
  const queue = [...linked].filter((n) => indegree.get(n) === 0)
  for (const n of queue) depth.set(n, 0)
  while (queue.length) {
    const n = queue.shift()!
    for (const m of dag(n)) {
      depth.set(m, Math.max(depth.get(m) ?? 0, depth.get(n)! + 1))
      indegree.set(m, indegree.get(m)! - 1)
      if (indegree.get(m) === 0) queue.push(m)
    }
  }

  const layers: string[][] = []
  for (const n of nodes) {
    if (!linked.has(n)) continue
    const d = depth.get(n) ?? 0
    ;(layers[d] ??= []).push(n)
  }
  // One barycentre pass: order each column by the mean position of the
  // nodes that depend on it, which removes most crossings in small graphs.
  for (let i = 1; i < layers.length; i++) {
    const prev = new Map(layers[i - 1]!.map((n, j) => [n, j]))
    const centre = (n: string): number => {
      const ps = layers[i - 1]!.filter((p) => dag(p).includes(n)).map((p) => prev.get(p)!)
      return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : Infinity
    }
    layers[i] = layers[i]!.toSorted((a, b) => centre(a) - centre(b))
  }

  return { layers, cycleEdges, isolated: nodes.filter((n) => !linked.has(n)) }
}
