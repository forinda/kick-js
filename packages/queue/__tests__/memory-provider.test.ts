import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import { Container, JOB_DISPATCHER } from '@forinda/kickjs'
import { Job, Process, QueueAdapter } from '@forinda/kickjs-queue'
import { MemoryQueueProvider, type MemoryJob } from '../src/testing'

beforeEach(() => {
  Container.reset()
})

async function start(provider: MemoryQueueProvider, workers?: boolean) {
  const container = Container.getInstance()
  await QueueAdapter({ provider, workers }).beforeStart({ container } as any)
  return container.resolve(JOB_DISPATCHER)
}

describe('MemoryQueueProvider', () => {
  it('runs @Process handlers and keeps the return value and progress', async () => {
    @Job('mem-email')
    class _Email {
      @Process('welcome')
      async welcome(job: MemoryJob<{ to: string }>) {
        await job.updateProgress(50)
        return `sent to ${job.data.to}`
      }
    }
    const provider = new MemoryQueueProvider()
    const dispatcher = await start(provider)
    const job = (await dispatcher.dispatch('mem-email', 'welcome', { to: 'a@b.c' })) as MemoryJob
    await provider.drain()
    expect(provider.getJob(job.id)).toMatchObject({
      state: 'completed',
      returnvalue: 'sent to a@b.c',
      progress: 50,
      attemptsMade: 1,
    })
  })

  it('retries up to attempts, then fails with the last reason', async () => {
    let calls = 0
    @Job('mem-retry')
    class _Retry {
      @Process('flaky')
      flaky() {
        calls++
        if (calls < 3) throw new Error(`try ${calls}`)
        return 'ok'
      }
      @Process('broken')
      broken() {
        throw new Error('always')
      }
    }
    const provider = new MemoryQueueProvider()
    const dispatcher = await start(provider)
    await dispatcher.dispatch('mem-retry', 'flaky', {}, { attempts: 3, backoff: 1 })
    await dispatcher.dispatch('mem-retry', 'broken', {}, { attempts: 2 })
    await provider.drain()
    const [flaky, broken] = provider.jobs('mem-retry')
    expect(flaky).toMatchObject({ state: 'completed', attemptsMade: 3, returnvalue: 'ok' })
    expect(broken).toMatchObject({ state: 'failed', attemptsMade: 2, failedReason: 'always' })
  })

  it('holds a delayed job until its delay passes', async () => {
    @Job('mem-delay')
    class _Delay {
      @Process()
      any() {}
    }
    const provider = new MemoryQueueProvider()
    const dispatcher = await start(provider)
    const job = (await dispatcher.dispatch('mem-delay', 'later', {}, { delay: 20 })) as MemoryJob
    expect(job.state).toBe('delayed')
    await new Promise((r) => setTimeout(r, 5))
    expect(job.state).toBe('delayed')
    await provider.drain()
    expect(job.state).toBe('completed')
  })

  it('with workers: false, records dispatched jobs without running them', async () => {
    let ran = false
    @Job('mem-api')
    class _Api {
      @Process('x')
      x() {
        ran = true
      }
    }
    const provider = new MemoryQueueProvider()
    const dispatcher = await start(provider, false)
    await dispatcher.dispatch('mem-api', 'x', { n: 1 })
    await provider.drain()
    expect(ran).toBe(false)
    expect(provider.jobs('mem-api')).toMatchObject([
      { name: 'x', data: { n: 1 }, state: 'waiting' },
    ])
  })
})
