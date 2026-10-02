import { describe, expect, it, vi } from 'vitest'
import type { JobInspector } from '@forinda/kickjs-devtools-kit'
import { findJobInspectors, getJob, listJobs, listJobSources, runJobAction } from '../src/jobs'
import type { TopologyApplicationLike } from '../src/topology'

const inspector = (): JobInspector => ({
  queues: async () => [{ name: 'email', counts: { failed: 1, waiting: 2 } }],
  jobs: vi.fn(async (_q, state, { start, end }) =>
    Array.from({ length: end - start + 1 }, (_, i) => ({
      id: String(start + i),
      name: 'welcome',
      state,
      attempts: 1,
    })),
  ),
  job: async (_q, id) =>
    id === '1' ? { id, name: 'welcome', state: 'failed', attempts: 3, data: {} } : null,
  retry: vi.fn(async () => {}),
  clean: vi.fn(async () => 4),
})

const app = (owners: object[]): TopologyApplicationLike => ({
  getAdapters: () => owners as never,
  getPlugins: () => [],
})

describe('job management endpoints', () => {
  it('finds inspectors on adapters and lists their queues and actions', async () => {
    const found = findJobInspectors(
      app([{ name: 'QueueAdapter', jobInspector: inspector }, { name: 'Other' }]),
    )
    expect([...found.keys()]).toEqual(['QueueAdapter'])
    const { body } = await listJobSources(found)
    expect(body).toEqual({
      sources: [
        {
          source: 'QueueAdapter',
          actions: ['retry', 'clean'],
          queues: [{ name: 'email', counts: { failed: 1, waiting: 2 } }],
        },
      ],
    })
  })

  it('pages jobs, capped at 100, and rejects unknown states', async () => {
    const found = new Map([['Q', inspector()]])
    const r = await listJobs(found, {
      source: 'Q',
      queue: 'email',
      state: 'failed',
      start: '0',
      end: '500',
    })
    expect((r.body as { jobs: unknown[] }).jobs).toHaveLength(100)
    expect((await listJobs(found, { source: 'Q', state: 'exploded' })).status).toBe(400)
    expect((await listJobs(found, { source: 'nope' })).status).toBe(404)
  })

  it('returns one job, or 404', async () => {
    const found = new Map([['Q', inspector()]])
    expect((await getJob(found, { source: 'Q', queue: 'email', id: '1' })).status).toBe(200)
    expect((await getJob(found, { source: 'Q', queue: 'email', id: '9' })).status).toBe(404)
  })

  it('runs supported actions and refuses the rest', async () => {
    const insp = inspector()
    const found = new Map([['Q', insp]])
    expect(
      await runJobAction(found, { source: 'Q', queue: 'email', action: 'retry', id: '1' }),
    ).toEqual({
      status: 200,
      body: { ok: true },
    })
    expect(insp.retry).toHaveBeenCalledWith('email', '1')
    expect(
      (
        await runJobAction(found, {
          source: 'Q',
          queue: 'email',
          action: 'clean',
          state: 'completed',
        })
      ).body,
    ).toEqual({
      ok: true,
      count: 4,
    })
    expect(
      (await runJobAction(found, { source: 'Q', queue: 'email', action: 'remove', id: '1' }))
        .status,
    ).toBe(501)
    expect(
      (await runJobAction(found, { source: 'Q', queue: 'email', action: 'retry' })).status,
    ).toBe(400)
    expect((await runJobAction(found, { source: 'Q', action: 'drop-table' })).status).toBe(400)
  })
})
