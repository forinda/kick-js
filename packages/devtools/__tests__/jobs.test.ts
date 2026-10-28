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

  describe('filtering with q', () => {
    /** A queue of `total` failed jobs: every 10th is an invoice, every 7th failed on SMTP. */
    const queueOf = (total: number): Map<string, JobInspector> => {
      const all = Array.from({ length: total }, (_, i) => ({
        id: String(i),
        name: i % 10 === 0 ? 'Invoice' : 'welcome',
        state: 'failed' as const,
        attempts: 1,
        failedReason: i % 7 === 0 ? 'SMTP refused' : 'timeout',
      }))
      return new Map([
        [
          'Q',
          {
            queues: async () => [],
            job: async () => null,
            jobs: vi.fn(async (_q, _s, { start, end }) => all.slice(start, end + 1)),
          },
        ],
      ])
    }
    type Page = { jobs: { id: string }[]; next: number | null; scanned: number }
    const list = async (found: Map<string, JobInspector>, q: Record<string, unknown>) =>
      (await listJobs(found, { source: 'Q', queue: 'email', state: 'failed', ...q })).body as Page

    it('returns a page of matches from across chunks, and where to carry on', async () => {
      const found = queueOf(2500)
      const first = await list(found, { q: 'invoice', start: 0, end: 49 })
      expect(first.jobs.map((j) => j.id)).toEqual(
        Array.from({ length: 50 }, (_, i) => String(i * 10)),
      )
      // The 50th match is job 490; the scan stops right after it.
      expect(first.next).toBe(491)
      expect(first.scanned).toBe(491)

      const second = await list(found, { q: 'invoice', start: first.next, end: first.next! + 49 })
      expect(second.jobs[0]!.id).toBe('500')
      expect(second.jobs).toHaveLength(50)
    })

    it('reports the end of the state, and matches id and failure reason, ignoring case', async () => {
      const found = queueOf(30)
      const smtp = await list(found, { q: 'smtp', start: 0, end: 49 })
      expect(smtp.jobs.map((j) => j.id)).toEqual(['0', '7', '14', '21', '28'])
      expect(smtp.next).toBeNull()
      expect(smtp.scanned).toBe(30)
      expect((await list(found, { q: '29', start: 0, end: 49 })).jobs.map((j) => j.id)).toEqual([
        '29',
      ])
    })

    it('stops after scanning 1000 jobs', async () => {
      const found = queueOf(5000)
      const page = await list(found, { q: 'nothing matches this', start: 0, end: 49 })
      expect(page.jobs).toEqual([])
      expect(page.scanned).toBe(1000)
      expect(page.next).toBe(1000)
    })
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
