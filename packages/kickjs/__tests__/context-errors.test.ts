import { describe, it, expect } from 'vitest'
import {
  MissingContributorError,
  ContributorCycleError,
  DuplicateContributorError,
} from '../src/core'

describe('MissingContributorError', () => {
  it('exposes key, dependent, and route fields', () => {
    const err = new MissingContributorError('tenant', 'project', 'GET /projects/:id')
    expect(err.key).toBe('tenant')
    expect(err.dependent).toBe('project')
    expect(err.route).toBe('GET /projects/:id')
  })

  it('formats a route-aware message', () => {
    const err = new MissingContributorError('tenant', 'project', 'GET /projects/:id')
    expect(err.message).toBe(
      "Missing context contributor 'tenant' required by 'project' on route GET /projects/:id",
    )
  })

  it('omits the route suffix when route is undefined', () => {
    const err = new MissingContributorError('tenant', 'project')
    expect(err.message).toBe("Missing context contributor 'tenant' required by 'project'")
    expect(err.route).toBeUndefined()
  })

  it('is recognisable as both Error and the specific subclass', () => {
    const err = new MissingContributorError('a', 'b')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(MissingContributorError)
    expect(err.name).toBe('MissingContributorError')
  })
})

describe('ContributorCycleError', () => {
  it('joins the cycle path with arrow separators', () => {
    const err = new ContributorCycleError(['tenant', 'project', 'tenant'], 'GET /x')
    expect(err.message).toBe(
      'Cycle in context contributors on route GET /x: tenant → project → tenant',
    )
  })

  it('omits the route suffix when route is undefined', () => {
    const err = new ContributorCycleError(['a', 'b', 'a'])
    expect(err.message).toBe('Cycle in context contributors: a → b → a')
  })

  it('freezes the cycle field independently of the input', () => {
    const cycle = ['a', 'b', 'a']
    const err = new ContributorCycleError(cycle)
    cycle.push('mutated')
    expect(err.cycle).toEqual(['a', 'b', 'a'])
    expect(Object.isFrozen(err.cycle)).toBe(true)
  })

  it('is recognisable as both Error and the specific subclass', () => {
    const err = new ContributorCycleError(['a', 'a'])
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(ContributorCycleError)
    expect(err.name).toBe('ContributorCycleError')
  })
})

describe('DuplicateContributorError', () => {
  it('lists conflicting source labels in the message', () => {
    const err = new DuplicateContributorError('tenant', [
      'LoadTenantFromHeader',
      'LoadTenantFromSubdomain',
    ])
    expect(err.message).toBe(
      "Duplicate context contributor for key 'tenant' at the same precedence level. " +
        'Sources: LoadTenantFromHeader, LoadTenantFromSubdomain',
    )
  })

  it('exposes key and frozen sources fields', () => {
    const sources = ['A', 'B']
    const err = new DuplicateContributorError('user', sources)
    sources.push('C')
    expect(err.key).toBe('user')
    expect(err.sources).toEqual(['A', 'B'])
    expect(Object.isFrozen(err.sources)).toBe(true)
  })

  it('is recognisable as both Error and the specific subclass', () => {
    const err = new DuplicateContributorError('x', ['a', 'b'])
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(DuplicateContributorError)
    expect(err.name).toBe('DuplicateContributorError')
  })
})
