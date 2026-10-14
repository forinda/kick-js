import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Application, Container, allOf, onEnv, onPackage, type AppAdapter } from '../src/index'

beforeEach(() => Container.reset())
afterEach(() => vi.unstubAllEnvs())

describe('condition helpers', () => {
  it('onEnv: set, or equal to a value — with the reason when not', () => {
    vi.stubEnv('KICK_COND_A', 'redis')
    expect(onEnv('KICK_COND_A')()).toBe(true)
    expect(onEnv('KICK_COND_A', 'redis')()).toBe(true)
    // The reason never carries the variable's value — it may be a secret.
    expect(onEnv('KICK_COND_A', 'memory')()).toBe("KICK_COND_A is not 'memory'")
    expect(onEnv('KICK_COND_A', 'memory')()).not.toContain('redis')
    expect(onEnv('KICK_COND_MISSING')()).toBe('KICK_COND_MISSING is not set')
  })

  it('onPackage: resolvable from the app', () => {
    expect(onPackage('vitest')()).toBe(true)
    expect(onPackage('kick-surely-not-installed')()).toBe(
      "package 'kick-surely-not-installed' is not installed",
    )
  })

  it('allOf: the first failure gives the reason', () => {
    expect(allOf(() => true, onEnv('KICK_COND_MISSING'))()).toBe('KICK_COND_MISSING is not set')
  })
})

describe('adapters with when', () => {
  it('leaves out adapters whose condition says no, and those that depend on them', async () => {
    const ran: string[] = []
    const hook = (name: string) => () => void ran.push(name)
    const adapters: AppAdapter[] = [
      { name: 'Always', beforeMount: hook('Always') },
      { name: 'Cache', when: onEnv('KICK_COND_MISSING'), beforeMount: hook('Cache') },
      { name: 'Sessions', dependsOn: ['Cache'], beforeMount: hook('Sessions') },
      {
        name: 'Broken',
        when: () => {
          throw new Error('bad check')
        },
        beforeMount: hook('Broken'),
      },
      { name: 'On', when: () => true, beforeMount: hook('On') },
    ]
    const app = new Application({ modules: [], adapters })
    await app.setup()

    expect(ran).toEqual(['Always', 'On'])
    expect(app.getAdapters().map((a) => a.name)).toEqual(['Always', 'On'])
    expect(app.getConditionReport()).toEqual([
      { adapter: 'Cache', enabled: false, reason: 'KICK_COND_MISSING is not set' },
      { adapter: 'Sessions', enabled: false, reason: 'depends on Cache, which is off' },
      // The error goes to the log, not the served report.
      { adapter: 'Broken', enabled: false, reason: 'its condition threw (see the server log)' },
      { adapter: 'On', enabled: true },
    ])
  })
})
