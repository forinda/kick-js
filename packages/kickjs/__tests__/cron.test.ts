/**
 * `@Cron`: jobs recorded by the decorator, run by `runCronJob` (enabled,
 * overlap, run context, error reporting), scheduled on Node by the opt-in
 * `KickCronAdapter`, and triggered on serverless over HTTP (`/_kick/cron/:id`,
 * behind `CRON_SECRET`) or by the Workers `scheduled()` handler.
 */
import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as h3v2 from 'h3-v2'
import {
  Container,
  Cron,
  KickCronAdapter,
  Service,
  createHandler,
  cronScheduleId,
  listCronJobs,
  runCronJob,
  runCronJobs,
  type CronRun,
  type KickHandler,
} from '../src/index'
import { setObservers } from '../src/core/observers'
import { createFetchHandler } from '../src/web'

beforeEach(() => {
  Container.reset()
  setObservers([])
})

const container = () => Container.getInstance()
/** Jobs by name — classes declared in earlier tests stay registered across resets. */
const jobNamed = (name: string) => listCronJobs(container()).find((j) => j.name === name)!
const own = (...names: string[]) => listCronJobs(container()).filter((j) => names.includes(j.name))

/** Declared per test, after Container.reset(), so the class registers into the fresh container. */
function jobsService(options: Parameters<typeof Cron>[1] = {}) {
  const runs: CronRun[] = []
  @Service()
  class ReportJobs {
    @Cron('0 * * * *', { meta: { batch: 5 }, ...options })
    async hourly(run: CronRun) {
      runs.push(run)
    }

    @Cron('*/5  *  * * *', { name: 'sweep' })
    sweep() {}
  }
  return { ReportJobs, runs }
}

describe('listCronJobs', () => {
  it('lists jobs of classes the container knows, with a default name and schedule id', () => {
    jobsService()
    const jobs = own('ReportJobs.hourly', 'sweep')
    expect(jobs.map((j) => [j.name, j.expression, j.scheduleId])).toEqual([
      ['ReportJobs.hourly', '0 * * * *', cronScheduleId('0 * * * *')],
      ['sweep', '*/5  *  * * *', cronScheduleId('*/5 * * * *')],
    ])
  })

  it('skips classes the container does not know', () => {
    jobsService()
    expect(listCronJobs({ has: () => false })).toEqual([])
  })

  it('keeps only the newest class of a name (HMR re-evaluation)', () => {
    jobsService()
    const { ReportJobs } = jobsService()
    expect(own('ReportJobs.hourly').map((j) => j.target)).toEqual([ReportJobs])
  })
})

describe('runCronJob', () => {
  it('passes the run context, meta included', async () => {
    const { runs } = jobsService()
    const job = jobNamed('ReportJobs.hourly')
    expect(await runCronJob(job, container(), 'manual')).toBe(true)
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({
      name: 'ReportJobs.hourly',
      expression: '0 * * * *',
      meta: { batch: 5 },
      trigger: 'manual',
    })
    expect(runs[0].firedAt).toBeInstanceOf(Date)
  })

  it('skips a disabled job — boolean or function', async () => {
    let on = false
    const { runs } = jobsService({ enabled: () => on })
    const job = jobNamed('ReportJobs.hourly')
    expect(await runCronJob(job, container(), 'manual')).toBe(false)
    on = true
    expect(await runCronJob(job, container(), 'manual')).toBe(true)
    expect(runs).toHaveLength(1)

    Container.reset()
    jobsService({ enabled: false })
    expect(await runCronJob(jobNamed('ReportJobs.hourly'), container(), 'manual')).toBe(false)
  })

  it('skips a tick while the previous run is busy, unless overlap is on', async () => {
    let release!: () => void
    let started = 0
    @Service()
    class Slow {
      @Cron('* * * * *', { name: 'slow' })
      async run() {
        started++
        await new Promise<void>((r) => (release = r))
      }

      @Cron('* * * * *', { name: 'slow-overlap', overlap: true })
      async runOverlap() {
        started++
        await new Promise<void>((r) => setTimeout(r, 5))
      }
    }
    void Slow
    const [slow, overlapping] = [jobNamed('slow'), jobNamed('slow-overlap')]

    const first = runCronJob(slow, container(), 'schedule')
    expect(await runCronJob(slow, container(), 'schedule')).toBe(false)
    release()
    expect(await first).toBe(true)

    const results = await Promise.all([
      runCronJob(overlapping, container(), 'schedule'),
      runCronJob(overlapping, container(), 'schedule'),
    ])
    expect(results).toEqual([true, true])
    expect(started).toBe(3)
  })

  it('reports a failure to the error observers and rethrows', async () => {
    const seen: unknown[] = []
    setObservers([{ name: 'spy', onError: (error, info) => void seen.push({ error, info }) }])
    @Service()
    class Broken {
      @Cron('0 0 * * *', { name: 'broken' })
      fail() {
        throw new Error('boom')
      }
    }
    void Broken
    const job = jobNamed('broken')
    await expect(runCronJob(job, container(), 'http')).rejects.toThrow('boom')
    expect(seen).toEqual([
      {
        error: expect.objectContaining({ message: 'boom' }),
        info: {
          source: 'cron',
          context: { job: 'broken', expression: '0 0 * * *', trigger: 'http' },
        },
      },
    ])
    // runCronJobs never rejects — it counts.
    expect(await runCronJobs(container(), { name: 'broken' }, 'manual')).toEqual({
      ran: 0,
      failed: 1,
    })
  })
})

describe('runCronJobs', () => {
  it('filters by name, schedule id or expression', async () => {
    const { runs } = jobsService()
    const c = container()
    expect(await runCronJobs(c, { name: 'sweep' }, 'manual')).toEqual({ ran: 1, failed: 0 })
    expect(await runCronJobs(c, { expression: '0 * * * *' }, 'manual')).toEqual({
      ran: 1,
      failed: 0,
    })
    expect(await runCronJobs(c, { scheduleId: cronScheduleId('0 * * * *') }, 'manual')).toEqual({
      ran: 1,
      failed: 0,
    })
    expect(await runCronJobs(c, { name: 'nope' }, 'manual')).toEqual({ ran: 0, failed: 0 })
    expect(runs).toHaveLength(2)
  })
})

describe('cronScheduleId', () => {
  it('is stable and ignores whitespace differences', () => {
    expect(cronScheduleId(' 0  *  * * * ')).toBe(cronScheduleId('0 * * * *'))
    expect(cronScheduleId('0 * * * *')).not.toBe(cronScheduleId('1 * * * *'))
    expect(cronScheduleId('0 * * * *')).toMatch(/^[0-9a-z]+$/)
  })
})

describe('KickCronAdapter', () => {
  it('schedules jobs with croner, runs runOnInit jobs, and stops on shutdown', async () => {
    const { runs } = jobsService({ runOnInit: true })
    const adapter = KickCronAdapter()
    await adapter.afterStart!({ container: container() } as never)
    await new Promise((r) => setTimeout(r, 0))
    expect(runs.map((r) => r.trigger)).toEqual(['init'])

    const state = (adapter.introspect!() as { state: { jobs: Array<{ name: string }> } }).state
    expect(state.jobs.map((j) => j.name)).toEqual(
      expect.arrayContaining(['ReportJobs.hourly', 'sweep']),
    )
    await adapter.shutdown!()
  })

  it('schedules nothing when disabled', async () => {
    const { runs } = jobsService({ runOnInit: true })
    const adapter = KickCronAdapter({ enabled: false })
    await adapter.afterStart!({ container: container() } as never)
    await new Promise((r) => setTimeout(r, 0))
    expect(runs).toEqual([])
  })
})

describe('HTTP trigger — /_kick/cron/:scheduleId', () => {
  const handlers: KickHandler[] = []
  afterEach(async () => {
    delete process.env.CRON_SECRET
    while (handlers.length) await handlers.pop()!.close()
  })
  const path = `https://site.example/_kick/cron/${cronScheduleId('0 * * * *')}`

  it('runs the jobs on that schedule for a request with the CRON_SECRET bearer', async () => {
    process.env.CRON_SECRET = 's3cret'
    const { ReportJobs, runs } = jobsService()
    const handler = createHandler({ modules: [], providers: [ReportJobs] } as never)
    handlers.push(handler)

    expect((await handler.fetch(new Request(path))).status).toBe(401)
    const wrong = await handler.fetch(
      new Request(path, { headers: { authorization: 'Bearer nope!!' } }),
    )
    expect(wrong.status).toBe(401)
    expect(runs).toEqual([])

    const ok = await handler.fetch(
      new Request(path, { headers: { authorization: 'Bearer s3cret' } }),
    )
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ ran: 1, failed: 0 })
    expect(runs.map((r) => r.trigger)).toEqual(['http'])
  })

  it('is not mounted without CRON_SECRET', async () => {
    const { ReportJobs, runs } = jobsService()
    const handler = createHandler({ modules: [], providers: [ReportJobs] } as never)
    handlers.push(handler)
    const res = await handler.fetch(
      new Request(path, { headers: { authorization: 'Bearer undefined' } }),
    )
    expect(res.status).toBe(404)
    expect(runs).toEqual([])
  })
})

describe('Workers — scheduled()', () => {
  it('runs the jobs whose expression matches event.cron', async () => {
    const { runs } = jobsService()
    const waited: Promise<unknown>[] = []
    const handler = createFetchHandler((env) => ({ h3: h3v2, modules: [], env }))
    await handler.scheduled({ cron: '0 * * * *' }, {}, { waitUntil: (p) => void waited.push(p) })
    expect(waited).toHaveLength(1)
    expect(runs.map((r) => r.trigger)).toEqual(['workers'])
  })
})
