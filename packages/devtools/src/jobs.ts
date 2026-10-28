/**
 * Job management for the Queues tab — over any {@link JobInspector} an
 * adapter or plugin exposes from `jobInspector()`. Each inspector is a
 * `source`, named after its owner, so two job tools can sit side by side.
 *
 * @module @forinda/kickjs-devtools/jobs
 */

import type { JobInspector, JobQueueInfo, JobState, JobSummary } from '@forinda/kickjs-devtools-kit'
import type { TopologyApplicationLike } from './topology'

const STATES: ReadonlySet<string> = new Set([
  'waiting',
  'active',
  'delayed',
  'completed',
  'failed',
  'paused',
])
const ACTIONS = ['retry', 'remove', 'retryAll', 'clean', 'pause', 'resume'] as const
type Action = (typeof ACTIONS)[number]

/** Most jobs one list request returns. */
const MAX_PAGE = 100
/**
 * Most jobs one filtered request looks at. Job tools can't search, so a filter
 * scans the state in pages; past this it returns what it found and where to
 * carry on.
 */
const MAX_SCAN = 1000

type Reply = { status: number; body: unknown }
const bad = (error: string, status = 400): Reply => ({ status, body: { error } })

/** Every inspector the app's adapters and plugins expose, keyed by owner name. */
export function findJobInspectors(app: TopologyApplicationLike): Map<string, JobInspector> {
  const found = new Map<string, JobInspector>()
  for (const owner of [...app.getAdapters(), ...app.getPlugins()]) {
    const get = (owner as { jobInspector?: () => JobInspector | undefined }).jobInspector
    if (typeof get !== 'function') continue
    const inspector = get.call(owner)
    if (inspector) found.set(owner.name ?? 'jobs', inspector)
  }
  return found
}

/** `GET /jobs` — each source's queues and the actions it supports. */
export async function listJobSources(inspectors: Map<string, JobInspector>): Promise<Reply> {
  const sources = await Promise.all(
    [...inspectors].map(async ([source, inspector]) => {
      const actions = ACTIONS.filter((a) => typeof inspector[a] === 'function')
      try {
        return { source, actions, queues: await inspector.queues() }
      } catch (err) {
        return { source, actions, queues: [] as JobQueueInfo[], error: message(err) }
      }
    }),
  )
  return { status: 200, body: { sources } }
}

/**
 * `GET /jobs/list?source&queue&state&start&end&q`
 *
 * Without `q`: the jobs at positions `start`–`end` (at most {@link MAX_PAGE}).
 * With `q`: the first jobs from `start` on whose id, name or failure reason
 * contains it (case-insensitive), up to `end - start + 1` of them, looking at no
 * more than {@link MAX_SCAN} jobs. `next` is where to carry on — `null` once the
 * state has no more jobs — and `scanned` how many were looked at.
 */
export async function listJobs(
  inspectors: Map<string, JobInspector>,
  q: Record<string, unknown>,
): Promise<Reply> {
  const inspector = inspectors.get(String(q.source ?? ''))
  if (!inspector) return bad('unknown source', 404)
  const state = String(q.state ?? 'failed')
  if (!STATES.has(state)) return bad(`unknown state '${state}'`)
  const start = Math.max(0, Number(q.start ?? 0) || 0)
  const end = Math.min(start + MAX_PAGE - 1, Math.max(start, Number(q.end ?? start + 49) || 0))
  const queue = String(q.queue ?? '')
  const needle = String(q.q ?? '')
    .trim()
    .toLowerCase()
  try {
    if (!needle) {
      const jobs = await inspector.jobs(queue, state as JobState, { start, end })
      return { status: 200, body: { jobs } }
    }
    const want = end - start + 1
    const jobs: JobSummary[] = []
    let at = start
    let next: number | null = start
    while (jobs.length < want && at - start < MAX_SCAN) {
      const chunk = await inspector.jobs(queue, state as JobState, {
        start: at,
        end: at + MAX_PAGE - 1,
      })
      let i = 0
      for (; i < chunk.length && jobs.length < want; i++) {
        if (matches(chunk[i]!, needle)) jobs.push(chunk[i]!)
      }
      at += i
      if (chunk.length < MAX_PAGE && i === chunk.length) {
        next = null // the state has no more jobs
        break
      }
      next = at
    }
    return { status: 200, body: { jobs, next, scanned: at - start } }
  } catch (err) {
    return bad(message(err), 500)
  }
}

const matches = (job: JobSummary, needle: string): boolean =>
  [job.id, job.name, job.failedReason].some((v) => v?.toLowerCase().includes(needle))

/** `GET /jobs/job?source&queue&id` */
export async function getJob(
  inspectors: Map<string, JobInspector>,
  q: Record<string, unknown>,
): Promise<Reply> {
  const inspector = inspectors.get(String(q.source ?? ''))
  if (!inspector) return bad('unknown source', 404)
  try {
    const job = await inspector.job(String(q.queue ?? ''), String(q.id ?? ''))
    return job ? { status: 200, body: job } : bad('job not found', 404)
  } catch (err) {
    return bad(message(err), 500)
  }
}

/** `POST /jobs/action?source&queue&action&id&state` */
export async function runJobAction(
  inspectors: Map<string, JobInspector>,
  q: Record<string, unknown>,
): Promise<Reply> {
  const inspector = inspectors.get(String(q.source ?? ''))
  if (!inspector) return bad('unknown source', 404)
  const action = String(q.action ?? '') as Action
  if (!ACTIONS.includes(action)) return bad(`unknown action '${action}'`)
  const queue = String(q.queue ?? '')
  const id = String(q.id ?? '')
  const state = String(q.state ?? '')
  try {
    switch (action) {
      case 'retry':
      case 'remove':
        if (!id) return bad('id is required')
        if (!inspector[action]) return bad(`${action} is not supported`, 501)
        await inspector[action]!(queue, id)
        return { status: 200, body: { ok: true } }
      case 'clean':
        if (!STATES.has(state)) return bad('state is required')
        if (!inspector.clean) return bad('clean is not supported', 501)
        return {
          status: 200,
          body: { ok: true, count: await inspector.clean(queue, state as JobState) },
        }
      default:
        if (!inspector[action]) return bad(`${action} is not supported`, 501)
        return { status: 200, body: { ok: true, count: (await inspector[action]!(queue)) ?? null } }
    }
  } catch (err) {
    return bad(message(err), 500)
  }
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))
