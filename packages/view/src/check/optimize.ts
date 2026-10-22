import type { CNode } from '../ast'

/** Merge adjacent static output and drop empty pieces, inside blocks too. */
export function optimize(nodes: CNode[]): CNode[] {
  const out: CNode[] = []
  for (const n of nodes) {
    const node = deep(n)
    const last = out[out.length - 1]
    if (node.k === 's') {
      if (!node.t) continue
      if (last?.k === 's') {
        last.t += node.t
        continue
      }
    }
    out.push(node)
  }
  return out
}

function deep(n: CNode): CNode {
  switch (n.k) {
    case 'if':
      return { ...n, br: n.br.map((b) => ({ ...b, b: optimize(b.b) })) }
    case 'for':
      return n.em ? { ...n, b: optimize(n.b), em: optimize(n.em) } : { ...n, b: optimize(n.b) }
    case 'sw':
      return {
        ...n,
        cs: n.cs.map((c) => ({ ...c, b: optimize(c.b) })),
        ...(n.d ? { d: optimize(n.d) } : {}),
      }
    case 'cmp':
      return { ...n, f: Object.fromEntries(Object.entries(n.f).map(([k, v]) => [k, optimize(v)])) }
    case 'o':
      return { ...n, fb: optimize(n.fb) }
    case 's':
      return { ...n }
    default:
      return n
  }
}
