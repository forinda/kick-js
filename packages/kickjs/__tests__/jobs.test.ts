/**
 * Background jobs in core: `@Job` / `@Process` record handlers, any runner
 * reads them (`listJobHandlers` / `listJobQueues`) and hands each job to
 * `runJob`, which routes it, reports failures (`source: 'job'`) and rethrows.
 * The web entry's `queue()` consumes Cloudflare Queues the same way.
 */
import 'reflect-metadata'
import { beforeEach, describe, expect, it } from 'vitest'
import * as h3v2 from 'h3-v2'
import {
  Container,
  Job,
  NoJobHandlerError,
  Process,
  listJobHandlers,
  listJobQueues,
  runJob,
  type JobLike,
} from '../src/index'
import { setObservers } from '../src/core/observers'
import { createFetchHandler } from '../src/web'

beforeEach(() => {
  Container.reset()
  setObservers([])
})

const container = () => Container.getInstance()

function mailJobs() {
  const ran: string[] = []
  @Job('mail')
  class MailJobs {
    @Process('welcome')
    welcome(job: JobLike<{ to: string }>) {
      ran.push(`welcome:${job.data.to}`)
    }
    @Process()
    other(job: JobLike) {
      ran.push(`other:${job.name}`)
    }
  }
  return { MailJobs, ran }
}

describe('discovery', () => {
  it('lists handlers and the queues they cover', () => {
    const { MailJobs } = mailJobs()
    const mine = listJobHandlers(container()).filter((h) => h.target === MailJobs)
    expect(mine.map((h) => [h.queue, h.jobName, h.handlerName])).toEqual([
      ['mail', 'welcome', 'welcome'],
      ['mail', undefined, 'other'],
    ])
    expect(listJobQueues(container())).toContain('mail')
  })

  it('keeps only the newest class of a name (HMR re-evaluation)', () => {
    mailJobs()
    const { MailJobs } = mailJobs()
    const targets = new Set(
      listJobHandlers(container())
        .filter((h) => h.queue === 'mail')
        .map((h) => h.target),
    )
    expect([...targets]).toEqual([MailJobs])
  })
})

describe('runJob', () => {
  it('routes to the named handler, else the catch-all, passing the job object through', async () => {
    const { ran } = mailJobs()
    await runJob(container(), 'mail', { name: 'welcome', data: { to: 'ada' } })
    await runJob(container(), 'mail', { name: 'digest', data: null })
    expect(ran).toEqual(['welcome:ada', 'other:digest'])
  })

  it('reports a failure with the runner context, then rethrows', async () => {
    @Job('pay')
    class _Pay {
      @Process('charge')
      charge() {
        throw new Error('card declined')
      }
    }
    const seen: unknown[] = []
    setObservers([{ name: 'rec', onError: (error, info) => void seen.push({ error, info }) }])
    await expect(
      runJob(container(), 'pay', { name: 'charge', data: {}, id: '9' }, { attempt: 3 }),
    ).rejects.toThrow('card declined')
    expect(seen).toEqual([
      {
        error: expect.objectContaining({ message: 'card declined' }),
        info: { source: 'job', context: { queue: 'pay', job: 'charge', id: '9', attempt: 3 } },
      },
    ])
  })

  it('throws NoJobHandlerError for a job nothing handles — it is not silently acknowledged', async () => {
    @Job('strict')
    class _Strict {
      @Process('known')
      known() {}
    }
    await expect(runJob(container(), 'strict', { name: 'unknown', data: null })).rejects.toThrow(
      NoJobHandlerError,
    )
    await expect(runJob(container(), 'nowhere', { name: 'x', data: null })).rejects.toThrow(
      'No @Process handler for job "x" on queue "nowhere"',
    )
  })
})

describe('Workers — queue()', () => {
  it('runs each message, acks successes and retries failures', async () => {
    const ran: unknown[] = []
    @Job('cf-q')
    class _Cf {
      @Process('resize')
      resize(job: JobLike) {
        if (job.data === 'bad') throw new Error('nope')
        ran.push(['resize', job.data, job.id])
      }
      @Process()
      any(job: JobLike) {
        ran.push(['any', job.data])
      }
    }
    const handler = createFetchHandler((env) => ({ h3: h3v2, modules: [], env }))
    const acks: string[] = []
    const retries: string[] = []
    const message = (id: string, body: unknown) => ({
      id,
      body,
      ack: () => void acks.push(id),
      retry: () => void retries.push(id),
    })
    await handler.queue({
      queue: 'cf-q',
      messages: [
        message('m1', { name: 'resize', data: 'a.png' }),
        message('m2', { name: 'resize', data: 'bad' }),
        message('m3', 'raw body'),
      ],
    })
    expect(ran).toEqual([
      ['resize', 'a.png', 'm1'],
      ['any', 'raw body'],
    ])
    expect(acks).toEqual(['m1', 'm3'])
    expect(retries).toEqual(['m2'])
  })
})
