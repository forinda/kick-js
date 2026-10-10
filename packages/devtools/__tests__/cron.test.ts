import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import { Container, Cron, Service } from '@forinda/kickjs'
import { cronSnapshot, runCronJobNow } from '../src/cron'

let calls = 0
let fail = false

@Service()
class SweepJobs {
  @Cron('*/5 * * * *', { description: 'Sweep' })
  async sweep() {
    calls++
    await Promise.resolve()
    if (fail) throw new Error('db down')
  }

  @Cron('0 * * * *', { enabled: false })
  off() {}
}

describe('cron jobs in DevTools', () => {
  let container: Container
  beforeEach(() => {
    Container.reset()
    container = Container.getInstance()
    container.register(SweepJobs, SweepJobs)
    calls = 0
    fail = false
  })

  it('lists resolvable jobs with their schedule and whether they are enabled', () => {
    const jobs = cronSnapshot(container)
    expect(jobs.map((j) => [j.name, j.expression, j.enabled])).toEqual([
      ['SweepJobs.sweep', '*/5 * * * *', true],
      ['SweepJobs.off', '0 * * * *', false],
    ])
    expect(jobs[0]).toMatchObject({
      className: 'SweepJobs',
      handler: 'sweep',
      description: 'Sweep',
    })
  })

  it('counts runs and failures whoever calls the method', async () => {
    const before = cronSnapshot(container)[0]!.stats
    const jobs = container.resolve(SweepJobs)
    await jobs.sweep()
    fail = true
    await expect(jobs.sweep()).rejects.toThrow('db down')
    const after = cronSnapshot(container)[0]!.stats
    expect(after.runs - before.runs).toBe(2)
    expect(after.failures - before.failures).toBe(1)
    expect(after).toMatchObject({ running: 0, lastOutcome: 'failed', lastError: 'db down' })
    expect(calls).toBe(2)
  })

  it('runs a job now, and refuses unknown or disabled ones', async () => {
    expect(runCronJobNow(container, 'SweepJobs.sweep')).toEqual({
      status: 202,
      body: { started: true },
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(calls).toBe(1)
    expect(runCronJobNow(container, 'nope').status).toBe(404)
    expect(runCronJobNow(container, 'SweepJobs.off').status).toBe(409)
  })
})
