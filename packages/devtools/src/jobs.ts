/**
 * Job management for the Queues tab — over any {@link JobInspector} an
 * adapter or plugin exposes from `jobInspector()`. Each inspector is a
 * `source`, named after its owner, so two job tools can sit side by side.
 *
 * @module @forinda/kickjs-devtools/jobs
 */

import type { JobInspector, JobQueueInfo, JobState } from '@forinda/kickjs-devtools-kit'
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

/** `GET /jobs/list?source&queue&state&start&end` */
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
  try {
    const jobs = await inspector.jobs(String(q.queue ?? ''), state as JobState, { start, end })
    return { status: 200, body: { jobs } }
  } catch (err) {
    return bad(message(err), 500)
  }
}

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
