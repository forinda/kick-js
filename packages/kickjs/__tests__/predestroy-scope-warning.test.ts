/**
 * `@PreDestroy` is inert on a SINGLETON, and used to be silently so.
 *
 * The request scope is what closes and triggers the hook, so on the default
 * scope there is nothing to fire it. `@PostConstruct` DOES run for singletons,
 * which is what makes this a trap: the pair reads as init/teardown while one
 * half opts out on a scope the author may never have considered.
 *
 * Reported as a Postgres pool never closed on shutdown — invisible in
 * development, surfacing as connection exhaustion under repeated restarts.
 *
 * @module @forinda/kickjs/__tests__/predestroy-scope-warning.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Container, PostConstruct, PreDestroy, Scope, Service } from '../src/index'

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  Container.reset()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => warn.mockRestore())

const said = () => warn.mock.calls.map((c) => String(c[0])).join('\n')

describe('@PreDestroy scope warning', () => {
  it('warns, naming the class and the scope, on a singleton', () => {
    @Service()
    class PoolHolder {
      @PreDestroy() close() {}
    }
    void PoolHolder
    expect(said()).toContain('PoolHolder')
    expect(said()).toMatch(/will never run/)
  })

  it('points at the adapter shutdown hook, since a warning without a fix is noise', () => {
    @Service()
    class Another {
      @PreDestroy() close() {}
    }
    void Another
    expect(said()).toMatch(/shutdown\(\)/)
  })

  it('stays quiet for a REQUEST-scoped service, where the hook does run', () => {
    @Service({ scope: Scope.REQUEST })
    class PerRequest {
      @PreDestroy() close() {}
    }
    void PerRequest
    expect(said()).not.toContain('PerRequest')
  })

  it('warns for every offending class, even when two share a name', () => {
    // Distinct constructors can share a `name` — two `DatabaseService` classes
    // in different modules is ordinary. Deduping by name silently suppressed
    // the second one's warning, which is the exact failure this exists to
    // prevent.
    function makeOne() {
      @Service()
      class DatabaseService {
        @PreDestroy() close() {}
      }
      return DatabaseService
    }
    const a = makeOne()
    const b = makeOne()
    expect(a).not.toBe(b)
    const hits = warn.mock.calls.filter((c) => String(c[0]).includes('DatabaseService'))
    expect(hits).toHaveLength(2)
  })

  it('stays quiet for a singleton without the hook', () => {
    @Service()
    class Plain {
      @PostConstruct() init() {}
    }
    void Plain
    expect(said()).not.toContain('Plain')
  })
})
