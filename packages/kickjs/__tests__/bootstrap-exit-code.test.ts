/**
 * KickJS's own uncaughtException / unhandledRejection listeners replace
 * Node's, which exit with 1 — so a boot that threw used to end the process
 * with 0, and a deploy read the crash as success. The listeners now set
 * `process.exitCode = 1`.
 */
import 'reflect-metadata'
import { afterEach, describe, expect, it } from 'vitest'
import { bootstrap, type AppAdapter } from '../src/index'

const g = globalThis as Record<string, unknown>
const events = ['uncaughtException', 'unhandledRejection'] as const

describe('bootstrap exit code', () => {
  const added: Array<[(typeof events)[number], (...args: unknown[]) => void]> = []

  afterEach(() => {
    for (const [event, listener] of added) process.off(event, listener)
    added.length = 0
    delete g.__kickBootstrapped
    delete g.__app
    process.exitCode = undefined
  })

  it('an uncaught boot failure leaves exit code 1', async () => {
    const before = new Map(events.map((e) => [e, process.listeners(e)]))
    const refuses: AppAdapter = {
      name: 'Migrations',
      beforeStart() {
        throw new Error('2 pending migrations')
      },
    }

    const boot = bootstrap({
      modules: [],
      port: 0,
      processHooks: 'errors-only',
      adapters: [refuses],
    })
    await expect(boot).rejects.toThrow('2 pending migrations')

    for (const event of events) {
      const listener = process.listeners(event).find((l) => !before.get(event)!.includes(l))
      expect(listener, `KickJS registers a ${event} listener`).toBeDefined()
      added.push([event, listener as (...args: unknown[]) => void])
    }

    // What Node does with the rejected top-level `await bootstrap()`.
    added[0]![1](new Error('2 pending migrations'))
    expect(process.exitCode).toBe(1)

    process.exitCode = undefined
    added[1]![1](new Error('late'), Promise.resolve())
    expect(process.exitCode).toBe(1)
  })
})
