import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Application, Container, type AppAdapter } from '../src/index'
import { StartupTimeline } from '../src/http/startup-timeline'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let app: Application | undefined
beforeEach(() => Container.reset())
afterEach(async () => {
  await app?.shutdown()
  app = undefined
})

describe('StartupTimeline', () => {
  it('charges a timed step to itself, not to the phase around it', async () => {
    // Two clocks: `outer` starts before the timeline (an upper bound on its
    // total), `inner` after (a lower bound on the time before the hook).
    const outer = performance.now()
    const timeline = new StartupTimeline()
    const inner = performance.now()
    await sleep(20)
    const before = performance.now() - inner
    await timeline.time('hook', () => sleep(60))
    timeline.mark('phase')
    const elapsed = performance.now() - outer
    const [hook, phase] = timeline.snapshot().steps
    expect(hook.name).toBe('hook')
    expect(hook.ms).toBeGreaterThanOrEqual(55)
    expect(phase.name).toBe('phase')
    // The phase keeps the time before the hook, without the hook's. Measured
    // against the real clock, not fixed bounds: a busy machine stretches sleeps.
    expect(phase.ms).toBeGreaterThanOrEqual(15)
    expect(phase.ms + hook.ms).toBeLessThanOrEqual(elapsed + 1)
    expect(phase.ms).toBeGreaterThanOrEqual(before - 1)
  })
})

describe('Application startup timeline', () => {
  it('records each phase and each adapter hook, in order', async () => {
    const slow: AppAdapter = {
      name: 'Slow',
      beforeMount: () => sleep(5),
      beforeStart: () => sleep(40),
      afterStart: () => {},
    }
    app = new Application({ modules: [], adapters: [slow], port: 0 })
    await app.start()

    const { totalMs, steps } = app.getStartupTimeline()
    expect(steps.map((s) => s.name)).toEqual([
      'Slow.beforeMount',
      'middleware',
      'modules',
      'routes',
      'Slow.beforeStart',
      'error handlers',
      'checks',
      'listen',
      'Slow.afterStart',
      'ready',
    ])
    expect(steps.find((s) => s.name === 'Slow.beforeStart')!.ms).toBeGreaterThanOrEqual(35)
    expect(totalMs).toBeGreaterThanOrEqual(steps.reduce((sum, s) => sum + s.ms, 0) - 1)
  })

  it('stops counting once startup is complete', async () => {
    app = new Application({ modules: [], port: 0 })
    await app.start()
    const first = app.getStartupTimeline().totalMs
    await sleep(40)
    expect(app.getStartupTimeline().totalMs).toBe(first)
  })

  it('starts over on each setup', async () => {
    app = new Application({ modules: [] })
    await app.setup()
    const first = app.getStartupTimeline().steps.length
    await app.setup()
    expect(app.getStartupTimeline().steps.length).toBe(first)
  })
})
