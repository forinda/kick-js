import { describe, expect, it } from 'vitest'
import { edgeKey, layoutGraph } from '../spa/src/lib/graph-layout'

describe('layoutGraph', () => {
  it('puts each node one column right of its deepest dependent', () => {
    const { layers, isolated } = layoutGraph(
      ['Ctrl', 'Svc', 'Repo', 'Audit', 'Logger'],
      [
        { from: 'Ctrl', to: 'Svc' },
        { from: 'Svc', to: 'Repo' },
        { from: 'Svc', to: 'Audit' },
        { from: 'Ctrl', to: 'Repo' },
      ],
    )
    expect(layers).toEqual([['Ctrl'], ['Svc'], ['Repo', 'Audit']])
    expect(isolated).toEqual(['Logger'])
  })

  it('reports a cycle edge and still lays every node out', () => {
    const { layers, cycleEdges } = layoutGraph(
      ['A', 'B'],
      [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'A' },
      ],
    )
    expect([...cycleEdges]).toEqual([edgeKey('B', 'A')])
    expect(layers.flat().toSorted()).toEqual(['A', 'B'])
  })

  it('ignores edges to unknown nodes', () => {
    const { layers, isolated } = layoutGraph(['A'], [{ from: 'A', to: 'Object' }])
    expect(layers).toEqual([])
    expect(isolated).toEqual(['A'])
  })
})
