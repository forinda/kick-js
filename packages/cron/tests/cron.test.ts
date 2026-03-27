import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import 'reflect-metadata'
import { Cron, getCronJobs, Container, Scope } from '@forinda/kickjs-core'
import { CronAdapter, IntervalScheduler, type CronScheduler } from '@forinda/kickjs-cron'

// ── @Cron Decorator ─────────────────────────────────────────────────────

describe('@Cron decorator', () => {
  it('registers cron metadata on a class', () => {
    class TestService {
      @Cron('*/5 * * * *')
      async run() {}
    }

    const jobs = getCronJobs(TestService)
    expect(jobs).toHaveLength(1)
    expect(jobs[0].expression).toBe('*/5 * * * *')
    expect(jobs[0].handlerName).toBe('run')
  })

  it('supports options: description, timezone, runOnInit', () => {
    class TestService {
      @Cron('0 0 * * *', {
        description: 'Nightly cleanup',
        timezone: 'UTC',
        runOnInit: true,
      })
      async cleanup() {}
    }

    const jobs = getCronJobs(TestService)
    expect(jobs[0].description).toBe('Nightly cleanup')
    expect(jobs[0].timezone).toBe('UTC')
    expect(jobs[0].runOnInit).toBe(true)
  })

  it('registers multiple cron jobs on one class', () => {
    class MultiService {
      @Cron('*/5 * * * *', { description: 'Job A' })
      async jobA() {}

      @Cron('0 * * * *', { description: 'Job B' })
      async jobB() {}
    }

    const jobs = getCronJobs(MultiService)
    expect(jobs).toHaveLength(2)
    expect(jobs[0].handlerName).toBe('jobA')
    expect(jobs[1].handlerName).toBe('jobB')
  })

  it('returns empty array for classes without @Cron', () => {
    class PlainService {}
    expect(getCronJobs(PlainService)).toEqual([])
  })
})

// ── IntervalScheduler ───────────────────────────────────────────────────

describe('IntervalScheduler', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('schedules and fires callbacks at intervals', () => {
    const scheduler = new IntervalScheduler()
    const handler = vi.fn()

    scheduler.schedule('*/5 * * * *', handler) // every 5 min

    expect(handler).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300000) // 5 min
    expect(handler).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(300000)
    expect(handler).toHaveBeenCalledTimes(2)

    scheduler.stopAll()
  })

  it('stops a single job', () => {
    const scheduler = new IntervalScheduler()
    const handler = vi.fn()

    const handle = scheduler.schedule('* * * * *', handler) // every minute
    scheduler.stop(handle)

    vi.advanceTimersByTime(120000)
    expect(handler).not.toHaveBeenCalled()
  })

  it('stops all jobs', () => {
    const scheduler = new IntervalScheduler()
    const h1 = vi.fn()
    const h2 = vi.fn()

    scheduler.schedule('* * * * *', h1)
    scheduler.schedule('*/5 * * * *', h2)
    scheduler.stopAll()

    vi.advanceTimersByTime(600000)
    expect(h1).not.toHaveBeenCalled()
    expect(h2).not.toHaveBeenCalled()
  })

  it('throws on invalid expression', () => {
    const scheduler = new IntervalScheduler()
    expect(() => scheduler.schedule('invalid', vi.fn())).toThrow('Invalid cron expression')
  })

  it('parses 6-part expressions (with seconds)', () => {
    const scheduler = new IntervalScheduler()
    const handler = vi.fn()

    scheduler.schedule('*/30 * * * * *', handler) // every 30 seconds

    vi.advanceTimersByTime(30000)
    expect(handler).toHaveBeenCalledTimes(1)

    scheduler.stopAll()
  })
})

// ── CronScheduler interface (custom implementation) ─────────────────────

describe('Custom CronScheduler', () => {
  it('CronAdapter accepts any CronScheduler implementation', async () => {
    const callbacks: Array<() => void | Promise<void>> = []

    const customScheduler: CronScheduler = {
      schedule: vi.fn((expr, cb) => {
        callbacks.push(cb)
        return callbacks.length - 1
      }),
      stop: vi.fn(),
      stopAll: vi.fn(),
    }

    Container.reset()

    class Svc {
      @Cron('0 0 * * *', { description: 'Daily job' })
      async daily() {}
    }

    const container = Container.getInstance()
    container.register(Svc, Svc, Scope.SINGLETON)

    const adapter = new CronAdapter({
      services: [Svc],
      scheduler: customScheduler,
    })

    await adapter.afterStart({ app: null as any, container, env: 'test', isProduction: false })

    expect(customScheduler.schedule).toHaveBeenCalledTimes(1)
    expect(customScheduler.schedule).toHaveBeenCalledWith(
      '0 0 * * *',
      expect.any(Function),
      { timezone: undefined },
    )

    adapter.shutdown()
    expect(customScheduler.stopAll).toHaveBeenCalled()
  })
})

// ── CronAdapter with IntervalScheduler ──────────────────────────────────

describe('CronAdapter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Container.reset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('schedules and executes cron jobs', async () => {
    const handler = vi.fn()

    class ScheduledService {
      @Cron('*/5 * * * *')
      async tick() {
        handler()
      }
    }

    const container = Container.getInstance()
    container.register(ScheduledService, ScheduledService, Scope.SINGLETON)

    const adapter = new CronAdapter({
      services: [ScheduledService],
      scheduler: new IntervalScheduler(),
    })
    await adapter.afterStart({ app: null as any, container, env: 'test', isProduction: false })

    expect(handler).not.toHaveBeenCalled()

    vi.advanceTimersByTime(300000)
    expect(handler).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(300000)
    expect(handler).toHaveBeenCalledTimes(2)

    adapter.shutdown()
  })

  it('runs job on init when runOnInit is true', async () => {
    const handler = vi.fn()

    class EagerService {
      @Cron('0 * * * *', { runOnInit: true })
      async initialize() {
        handler()
      }
    }

    const container = Container.getInstance()
    container.register(EagerService, EagerService, Scope.SINGLETON)

    const adapter = new CronAdapter({
      services: [EagerService],
      scheduler: new IntervalScheduler(),
    })
    await adapter.afterStart({ app: null as any, container, env: 'test', isProduction: false })

    expect(handler).toHaveBeenCalledTimes(1)

    adapter.shutdown()
  })

  it('does nothing when disabled', async () => {
    const handler = vi.fn()

    class Svc {
      @Cron('* * * * *')
      async tick() {
        handler()
      }
    }

    const container = Container.getInstance()
    container.register(Svc, Svc, Scope.SINGLETON)

    const adapter = new CronAdapter({
      services: [Svc],
      enabled: false,
      scheduler: new IntervalScheduler(),
    })
    await adapter.afterStart({ app: null as any, container, env: 'test', isProduction: false })

    vi.advanceTimersByTime(120000)
    expect(handler).not.toHaveBeenCalled()
  })

  it('clears all timers on shutdown', async () => {
    const handler = vi.fn()

    class Svc {
      @Cron('*/5 * * * *')
      async tick() {
        handler()
      }
    }

    const container = Container.getInstance()
    container.register(Svc, Svc, Scope.SINGLETON)

    const adapter = new CronAdapter({
      services: [Svc],
      scheduler: new IntervalScheduler(),
    })
    await adapter.afterStart({ app: null as any, container, env: 'test', isProduction: false })

    adapter.shutdown()

    vi.advanceTimersByTime(600000)
    expect(handler).not.toHaveBeenCalled()
  })

  it('handles errors in cron jobs gracefully', async () => {
    class FailingService {
      @Cron('* * * * *')
      async broken() {
        throw new Error('boom')
      }
    }

    const container = Container.getInstance()
    container.register(FailingService, FailingService, Scope.SINGLETON)

    const adapter = new CronAdapter({
      services: [FailingService],
      scheduler: new IntervalScheduler(),
    })
    await adapter.afterStart({ app: null as any, container, env: 'test', isProduction: false })

    expect(() => vi.advanceTimersByTime(60000)).not.toThrow()

    adapter.shutdown()
  })

  it('skips services without @Cron methods', async () => {
    class PlainService {
      async doStuff() {}
    }

    const container = Container.getInstance()
    container.register(PlainService, PlainService, Scope.SINGLETON)

    const adapter = new CronAdapter({
      services: [PlainService],
      scheduler: new IntervalScheduler(),
    })

    await expect(adapter.afterStart({ app: null as any, container, env: 'test', isProduction: false })).resolves.toBeUndefined()
    adapter.shutdown()
  })
})
