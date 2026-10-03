/** The job and cron examples in docs/guide/testing/background.md, run as written. */
import { describe, expect, it } from 'vitest'
import {
  Controller,
  Cron,
  Inject,
  JOB_DISPATCHER,
  Job,
  Post,
  Process,
  Service,
  runCronJobs,
  runJob,
  type CronRun,
  type JobDispatcher,
} from '@forinda/kickjs'
import { createTestApp, createTestModule } from '../src/index'

const delivered: string[] = []
const runs: string[] = []

@Job('emails')
class EmailJobs {
  @Process('welcome')
  async welcome(job: { data: { to: string } }) {
    delivered.push(job.data.to)
  }
}

@Service()
class Reports {
  @Cron('0 * * * *')
  async hourly(run: CronRun) {
    runs.push(run.trigger)
  }
}

@Controller()
class SignupController {
  constructor(@Inject(JOB_DISPATCHER) private readonly jobs: JobDispatcher) {}

  @Post('/')
  async signup() {
    await this.jobs.dispatch('emails', 'welcome', { to: 'ada@x.io' })
    return { ok: true }
  }
}

const AppModule = createTestModule({
  register: (c) => {
    c.register(EmailJobs, EmailJobs)
    c.register(Reports, Reports)
  },
  routes: () => ({ path: '/signup', controller: SignupController }),
})

describe('jobs and cron in tests', () => {
  it('runs a job handler directly', async () => {
    const { container } = await createTestApp({
      modules: [AppModule],
      overrides: [[JOB_DISPATCHER, { dispatch: async () => undefined }]],
    })
    await runJob(container, 'emails', { name: 'welcome', data: { to: 'grace@x.io' } })
    expect(delivered).toContain('grace@x.io')
  })

  it('records what an endpoint enqueues with a fake dispatcher', async () => {
    const dispatched: Array<{ queue: string; name: string; data: unknown }> = []
    const recording: JobDispatcher = {
      dispatch: async (queue, name, data) => {
        dispatched.push({ queue, name, data })
      },
    }
    const { client } = await createTestApp({
      modules: [AppModule],
      overrides: [[JOB_DISPATCHER, recording]],
    })
    await client().post('/api/v1/signup').expect(200)
    expect(dispatched).toEqual([{ queue: 'emails', name: 'welcome', data: { to: 'ada@x.io' } }])
  })

  it('runs a cron job on demand', async () => {
    const { container } = await createTestApp({
      modules: [AppModule],
      overrides: [[JOB_DISPATCHER, { dispatch: async () => undefined }]],
    })
    const result = await runCronJobs(container, { name: 'Reports.hourly' }, 'manual')
    expect(result).toEqual({ ran: 1, failed: 0 })
    expect(runs).toEqual(['manual'])
  })
})
