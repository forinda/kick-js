import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Application, Container, StartupCheckError, defineCheck } from '../src/index'

let app: Application | undefined
const env = process.env.NODE_ENV
beforeEach(() => Container.reset())
afterEach(async () => {
  await app?.shutdown()
  app = undefined
  process.env.NODE_ENV = env
})

describe('startup checks', () => {
  it('fails startup on an error, listing every error with its fix', async () => {
    const a = defineCheck({
      name: 'a',
      run: () => ({ id: 'APP-E001', level: 'error', message: 'first', fix: 'do x' }),
    })
    const b = defineCheck({
      name: 'b',
      run: () => [{ id: 'APP-E002', level: 'error', message: 'second' }],
    })
    app = new Application({ modules: [], port: 0, checks: [a, b] })
    const failure = await app.start().catch((err) => err)
    expect(failure).toBeInstanceOf(StartupCheckError)
    expect((failure as StartupCheckError).messages.map((m) => m.id)).toEqual([
      'APP-E001',
      'APP-E002',
    ])
    expect((failure as Error).message).toContain('fix: do x')
    // Nothing listened.
    expect(app.getHttpServer()?.listening ?? false).toBe(false)
    app = undefined
  })

  it('skips silenced IDs, and a check that throws does not stop startup', async () => {
    const broken = defineCheck({
      name: 'broken',
      run: () => {
        throw new Error('bug in the check')
      },
    })
    const known = defineCheck({
      name: 'known',
      run: () => ({ id: 'APP-E003', level: 'error', message: 'accepted risk' }),
    })
    app = new Application({
      modules: [],
      port: 0,
      checks: [broken, known],
      silenceChecks: ['APP-E003'],
    })
    await expect(app.start()).resolves.toBeUndefined()
  })

  it('sees the mounted routes', async () => {
    const seen = vi.fn()
    app = new Application({
      modules: [],
      port: 0,
      checks: [defineCheck({ name: 'routes', run: ({ routes }) => void seen(routes) })],
    })
    await app.start()
    expect(seen).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ method: 'GET', path: '/health/live' })]),
    )
  })

  it('runs deploy checks, including the built-in ones, only in production', async () => {
    const run = vi.fn()
    const deployOnly = defineCheck({ name: 'deploy', deploy: true, run })

    app = new Application({ modules: [], port: 0, checks: [deployOnly] })
    await app.start()
    expect(run).not.toHaveBeenCalled()
    await app.shutdown()

    Container.reset()
    process.env.NODE_ENV = 'production'
    const lines: string[] = []
    const warn = vi.spyOn(console, 'warn').mockImplementation((...args) => {
      lines.push(args.join(' '))
    })
    try {
      app = new Application({ modules: [], port: 0, trustProxy: true, checks: [deployOnly] })
      await app.start()
    } finally {
      warn.mockRestore()
    }
    expect(run).toHaveBeenCalledOnce()
    const output = lines.join('\n')
    expect(output).toContain('KICK-SEC-W001')
    expect(output).toContain('KICK-SEC-W002')
  })
})
