import { describe, it, expect } from 'vitest'
import {
  buildPipeline,
  defineContextDecorator,
  ContributorCycleError,
  DuplicateContributorError,
  MissingContributorError,
  type ContributorRegistration,
  type ContributorSource,
  type SourcedRegistration,
} from '../src/core'

function reg(opts: {
  key: string
  dependsOn?: string[]
  optional?: boolean
}): ContributorRegistration {
  return defineContextDecorator({
    key: opts.key,
    dependsOn: opts.dependsOn,
    optional: opts.optional,
    resolve: () => undefined,
  }).registration as ContributorRegistration
}

function sourced(
  source: ContributorSource,
  registration: ContributorRegistration,
  label?: string,
): SourcedRegistration {
  return { source, registration, label }
}

function indexOfKey(contributors: readonly ContributorRegistration[], key: string): number {
  return contributors.findIndex((c) => c.key === key)
}

describe('buildPipeline — empty / trivial', () => {
  it('returns an empty pipeline for empty input', () => {
    const pipeline = buildPipeline([])
    expect(pipeline.contributors).toEqual([])
    expect(pipeline.keys.size).toBe(0)
  })

  it('passes through a single contributor with no deps', () => {
    const pipeline = buildPipeline([sourced('method', reg({ key: 'tenant' }))])
    expect(pipeline.contributors.map((c) => c.key)).toEqual(['tenant'])
    expect(pipeline.keys.has('tenant')).toBe(true)
  })

  it('freezes contributors and keys', () => {
    const pipeline = buildPipeline([sourced('method', reg({ key: 'tenant' }))])
    expect(Object.isFrozen(pipeline.contributors)).toBe(true)
    expect(Object.isFrozen(pipeline)).toBe(true)
  })
})

describe('buildPipeline — precedence dedup', () => {
  it('method beats class beats module beats global for the same key', () => {
    const methodReg = reg({ key: 'tenant' })
    const classReg = reg({ key: 'tenant' })
    const moduleReg = reg({ key: 'tenant' })
    const globalReg = reg({ key: 'tenant' })

    const pipeline = buildPipeline([
      sourced('global', globalReg),
      sourced('module', moduleReg),
      sourced('class', classReg),
      sourced('method', methodReg),
    ])

    expect(pipeline.contributors).toHaveLength(1)
    expect(pipeline.contributors[0]).toBe(methodReg)
  })

  it('class beats module when no method-level entry exists', () => {
    const classReg = reg({ key: 'tenant' })
    const moduleReg = reg({ key: 'tenant' })

    const pipeline = buildPipeline([
      sourced('module', moduleReg),
      sourced('class', classReg),
    ])

    expect(pipeline.contributors[0]).toBe(classReg)
  })

  it('keeps non-conflicting contributors from every level', () => {
    const pipeline = buildPipeline([
      sourced('method', reg({ key: 'tenant' })),
      sourced('class', reg({ key: 'user' })),
      sourced('module', reg({ key: 'flags' })),
      sourced('global', reg({ key: 'requestStartedAt' })),
    ])

    expect([...pipeline.keys].sort()).toEqual([
      'flags',
      'requestStartedAt',
      'tenant',
      'user',
    ])
  })
})

describe('buildPipeline — duplicate detection (intra-source)', () => {
  it('throws DuplicateContributorError when two method-level entries share a key', () => {
    expect(() =>
      buildPipeline([
        sourced('method', reg({ key: 'tenant' }), 'LoadFromHeader'),
        sourced('method', reg({ key: 'tenant' }), 'LoadFromSubdomain'),
      ]),
    ).toThrowError(DuplicateContributorError)
  })

  it('error message includes both source labels', () => {
    let captured: unknown
    try {
      buildPipeline([
        sourced('module', reg({ key: 'tenant' }), 'A'),
        sourced('module', reg({ key: 'tenant' }), 'B'),
      ])
    } catch (err) {
      captured = err
    }
    expect(captured).toBeInstanceOf(DuplicateContributorError)
    const err = captured as DuplicateContributorError
    expect(err.key).toBe('tenant')
    expect(err.sources).toEqual(['A', 'B'])
  })

  it('falls back to "<source>#<index>" labels when none provided', () => {
    let captured: unknown
    try {
      buildPipeline([
        sourced('class', reg({ key: 'x' })),
        sourced('class', reg({ key: 'x' })),
      ])
    } catch (err) {
      captured = err
    }
    expect((captured as DuplicateContributorError).sources).toEqual(['class#0', 'class#1'])
  })

  it('does not flag duplicates that resolve to the same key across levels', () => {
    expect(() =>
      buildPipeline([
        sourced('method', reg({ key: 'tenant' })),
        sourced('class', reg({ key: 'tenant' })),
      ]),
    ).not.toThrow()
  })
})

describe('buildPipeline — dependsOn validation', () => {
  it('throws MissingContributorError when a dependsOn key has no producer', () => {
    expect(() =>
      buildPipeline([sourced('method', reg({ key: 'project', dependsOn: ['tenant'] }))], {
        route: 'GET /projects/:id',
      }),
    ).toThrowError(MissingContributorError)
  })

  it('error reports the dependent and route in the message', () => {
    let captured: unknown
    try {
      buildPipeline(
        [sourced('method', reg({ key: 'project', dependsOn: ['tenant'] }))],
        { route: 'GET /projects/:id' },
      )
    } catch (err) {
      captured = err
    }
    const err = captured as MissingContributorError
    expect(err.key).toBe('tenant')
    expect(err.dependent).toBe('project')
    expect(err.route).toBe('GET /projects/:id')
  })

  it('passes when all dependsOn keys are produced by the surviving set', () => {
    const pipeline = buildPipeline([
      sourced('method', reg({ key: 'tenant' })),
      sourced('method', reg({ key: 'project', dependsOn: ['tenant'] })),
    ])
    expect(pipeline.contributors).toHaveLength(2)
  })

  it('still validates after lower-precedence overrides are dropped', () => {
    // module-level produces 'tenant', but a method-level overrides it.
    // The method-level entry has no deps, so 'tenant' is still produced.
    expect(() =>
      buildPipeline([
        sourced('module', reg({ key: 'tenant' })),
        sourced('method', reg({ key: 'tenant' })),
        sourced('method', reg({ key: 'project', dependsOn: ['tenant'] })),
      ]),
    ).not.toThrow()
  })
})

describe('buildPipeline — topo-sort', () => {
  it('orders dependents after their dependencies', () => {
    const pipeline = buildPipeline([
      sourced('method', reg({ key: 'project', dependsOn: ['tenant'] })),
      sourced('method', reg({ key: 'tenant' })),
    ])
    const tenantIdx = indexOfKey(pipeline.contributors, 'tenant')
    const projectIdx = indexOfKey(pipeline.contributors, 'project')
    expect(tenantIdx).toBeLessThan(projectIdx)
  })

  it('handles a chain — A → B → C → D', () => {
    const pipeline = buildPipeline([
      sourced('method', reg({ key: 'd', dependsOn: ['c'] })),
      sourced('method', reg({ key: 'c', dependsOn: ['b'] })),
      sourced('method', reg({ key: 'b', dependsOn: ['a'] })),
      sourced('method', reg({ key: 'a' })),
    ])
    expect(pipeline.contributors.map((c) => c.key)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('handles a diamond — D depends on B and C, both depend on A', () => {
    const pipeline = buildPipeline([
      sourced('method', reg({ key: 'a' })),
      sourced('method', reg({ key: 'b', dependsOn: ['a'] })),
      sourced('method', reg({ key: 'c', dependsOn: ['a'] })),
      sourced('method', reg({ key: 'd', dependsOn: ['b', 'c'] })),
    ])
    const keys = pipeline.contributors.map((c) => c.key)
    expect(keys.indexOf('a')).toBeLessThan(keys.indexOf('b'))
    expect(keys.indexOf('a')).toBeLessThan(keys.indexOf('c'))
    expect(keys.indexOf('b')).toBeLessThan(keys.indexOf('d'))
    expect(keys.indexOf('c')).toBeLessThan(keys.indexOf('d'))
  })
})

describe('buildPipeline — cycle detection', () => {
  it('throws ContributorCycleError on a 2-node cycle', () => {
    expect(() =>
      buildPipeline([
        sourced('method', reg({ key: 'a', dependsOn: ['b'] })),
        sourced('method', reg({ key: 'b', dependsOn: ['a'] })),
      ]),
    ).toThrowError(ContributorCycleError)
  })

  it('exposes the cycle path on the error', () => {
    let captured: unknown
    try {
      buildPipeline(
        [
          sourced('method', reg({ key: 'a', dependsOn: ['b'] })),
          sourced('method', reg({ key: 'b', dependsOn: ['a'] })),
        ],
        { route: 'GET /x' },
      )
    } catch (err) {
      captured = err
    }
    const err = captured as ContributorCycleError
    expect(err.cycle).toEqual(['a', 'b', 'a'])
    expect(err.route).toBe('GET /x')
  })

  it('detects a 3-node cycle and isolates it from non-cyclic nodes', () => {
    let captured: unknown
    try {
      buildPipeline([
        sourced('method', reg({ key: 'standalone' })),
        sourced('method', reg({ key: 'a', dependsOn: ['b'] })),
        sourced('method', reg({ key: 'b', dependsOn: ['c'] })),
        sourced('method', reg({ key: 'c', dependsOn: ['a'] })),
      ])
    } catch (err) {
      captured = err
    }
    const err = captured as ContributorCycleError
    // Cycle path should start and end with the same node and not include 'standalone'.
    expect(err.cycle[0]).toBe(err.cycle[err.cycle.length - 1])
    expect(err.cycle).not.toContain('standalone')
  })
})
