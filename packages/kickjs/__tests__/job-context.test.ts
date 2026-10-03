/** Job context: a value captured at dispatch is restored around the handler. */
import 'reflect-metadata'
import { AsyncLocalStorage } from 'node:async_hooks'
import { beforeEach, expect, it } from 'vitest'
import {
  Container,
  JOB_CONTEXT_FIELD,
  Job,
  Process,
  registerJobContext,
  runJob,
  stampJobContext,
  type JobLike,
} from '../src'

const trace = new AsyncLocalStorage<string>()
registerJobContext<string>({
  key: 'test/trace',
  capture: () => trace.getStore(),
  restore: (id, run) => trace.run(id, run),
})

beforeEach(() => Container.reset())

it('carries the dispatching context to the handler, and keeps it out of job.data', async () => {
  const seen: Array<{ trace: string | undefined; data: unknown }> = []
  @Job('reports')
  class ReportJobs {
    @Process('build')
    build(job: JobLike<{ month: string }>) {
      seen.push({ trace: trace.getStore(), data: { ...job.data } })
    }
  }
  void ReportJobs

  const data = trace.run('req-42', () => stampJobContext({ month: '2026-10' }))
  expect(data).toEqual({ month: '2026-10', [JOB_CONTEXT_FIELD]: { 'test/trace': 'req-42' } })
  // Serialized and back, as a queue would.
  const job = { name: 'build', data: JSON.parse(JSON.stringify(data)) }
  await runJob(Container.getInstance(), 'reports', job)
  expect(seen).toEqual([{ trace: 'req-42', data: { month: '2026-10' } }])

  // Nothing to carry, or data that isn't a plain object: left as is.
  expect(stampJobContext({ month: 'x' })).toEqual({ month: 'x' })
  expect(trace.run('t', () => stampJobContext('text'))).toBe('text')
})
