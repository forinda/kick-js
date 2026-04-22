import { describe, it, expect } from 'vitest'
import {
  mountSort,
  DuplicateMountNameError,
  MissingMountDepError,
  MountCycleError,
} from '../src/core'

interface FakeMount {
  name: string
  dependsOn?: readonly string[]
}

const mk = (name: string, dependsOn?: readonly string[]): FakeMount => ({ name, dependsOn })
const names = (items: readonly FakeMount[]): string[] => items.map((i) => i.name)

describe('mountSort — empty / trivial', () => {
  it('returns an empty array for empty input', () => {
    expect(mountSort<FakeMount>([], 'plugin')).toEqual([])
  })

  it('passes through a single item with no deps', () => {
    expect(names(mountSort([mk('A')], 'plugin'))).toEqual(['A'])
  })
})

describe('mountSort — declaration order preservation (no dependsOn)', () => {
  it('keeps input order when no item declares dependsOn', () => {
    const items = [mk('A'), mk('B'), mk('C'), mk('D')]
    expect(names(mountSort(items, 'plugin'))).toEqual(['A', 'B', 'C', 'D'])
  })
})

describe('mountSort — dependsOn ordering', () => {
  it('moves a dependent after its dependency', () => {
    // Declared B-then-A but B depends on A → A must come first
    const items = [mk('B', ['A']), mk('A')]
    expect(names(mountSort(items, 'plugin'))).toEqual(['A', 'B'])
  })

  it('handles a chain A → B → C → D', () => {
    const items = [mk('D', ['C']), mk('C', ['B']), mk('B', ['A']), mk('A')]
    expect(names(mountSort(items, 'plugin'))).toEqual(['A', 'B', 'C', 'D'])
  })

  it('handles a diamond — D depends on B+C, both depend on A', () => {
    const items = [mk('D', ['B', 'C']), mk('C', ['A']), mk('B', ['A']), mk('A')]
    const sorted = names(mountSort(items, 'plugin'))
    expect(sorted.indexOf('A')).toBeLessThan(sorted.indexOf('B'))
    expect(sorted.indexOf('A')).toBeLessThan(sorted.indexOf('C'))
    expect(sorted.indexOf('B')).toBeLessThan(sorted.indexOf('D'))
    expect(sorted.indexOf('C')).toBeLessThan(sorted.indexOf('D'))
  })

  it('preserves declaration order between items that do not depend on each other', () => {
    // B and C are both root nodes; they should sort by input order.
    const items = [mk('B'), mk('C'), mk('A', ['B', 'C'])]
    expect(names(mountSort(items, 'plugin'))).toEqual(['B', 'C', 'A'])
  })
})

describe('mountSort — duplicate name detection', () => {
  it('throws DuplicateMountNameError when two items share a name', () => {
    expect(() => mountSort([mk('A'), mk('A')], 'plugin')).toThrowError(DuplicateMountNameError)
  })

  it('error reports the duplicate name + kind', () => {
    let captured: unknown
    try {
      mountSort([mk('TenantAdapter'), mk('TenantAdapter')], 'adapter')
    } catch (err) {
      captured = err
    }
    const err = captured as DuplicateMountNameError
    expect(err.kind).toBe('adapter')
    expect(err.mountName).toBe('TenantAdapter')
  })
})

describe('mountSort — missing dependency detection', () => {
  it('throws MissingMountDepError when dependsOn references an unknown name', () => {
    expect(() => mountSort([mk('A', ['Nope'])], 'plugin')).toThrowError(MissingMountDepError)
  })

  it('error names both the missing dep and the dependent', () => {
    let captured: unknown
    try {
      mountSort([mk('AuthAdapter', ['TenantAdapter'])], 'adapter')
    } catch (err) {
      captured = err
    }
    const err = captured as MissingMountDepError
    expect(err.kind).toBe('adapter')
    expect(err.missing).toBe('TenantAdapter')
    expect(err.dependent).toBe('AuthAdapter')
  })
})

describe('mountSort — cycle detection', () => {
  it('throws MountCycleError on a 2-node cycle', () => {
    expect(() => mountSort([mk('A', ['B']), mk('B', ['A'])], 'plugin')).toThrowError(
      MountCycleError,
    )
  })

  it('exposes a closed cycle path on the error', () => {
    let captured: unknown
    try {
      mountSort([mk('A', ['B']), mk('B', ['A'])], 'plugin')
    } catch (err) {
      captured = err
    }
    const err = captured as MountCycleError
    expect(err.kind).toBe('plugin')
    expect(err.cycle).toEqual(['A', 'B', 'A'])
  })

  it('detects a 3-node cycle and isolates it from non-cyclic standalone nodes', () => {
    let captured: unknown
    try {
      mountSort([mk('standalone'), mk('A', ['B']), mk('B', ['C']), mk('C', ['A'])], 'plugin')
    } catch (err) {
      captured = err
    }
    const err = captured as MountCycleError
    expect(err.cycle[0]).toBe(err.cycle[err.cycle.length - 1])
    expect(err.cycle).not.toContain('standalone')
  })
})
