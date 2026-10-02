/**
 * {@link JobInspector} over BullMQ queues — what the DevTools Queues tab
 * uses to list, inspect, retry and remove jobs. Providers without a job
 * store (RabbitMQ, Kafka, Redis pub/sub) can't list jobs; their queues show
 * without counts and listing them says so.
 */
import type {
  JobDetail,
  JobInspector,
  JobQueueInfo,
  JobState,
  JobSummary,
} from '@forinda/kickjs-devtools-kit'

/** The slice of a BullMQ `Queue` the inspector uses. */
interface BullQueue {
  getJobCounts(...types: string[]): Promise<Record<string, number>>
  getJobs(types: string[], start: number, end: number, asc?: boolean): Promise<BullJob[]>
  getJob(id: string): Promise<BullJob | undefined>
  isPaused(): Promise<boolean>
  pause(): Promise<void>
  resume(): Promise<void>
  retryJobs(opts: { state: string }): Promise<void>
  clean(grace: number, limit: number, type: string): Promise<string[]>
}

interface BullJob {
  id?: string
  name: string
  data: unknown
  opts?: { attempts?: number } & Record<string, unknown>
  attemptsMade: number
  failedReason?: string
  stacktrace?: string[]
  returnvalue?: unknown
  timestamp?: number
  processedOn?: number
  finishedOn?: number
  delay?: number
  progress?: unknown
  getState(): Promise<string>
  retry(): Promise<void>
  remove(): Promise<void>
}

const STATES: JobState[] = ['waiting', 'active', 'delayed', 'completed', 'failed', 'paused']
/** BullMQ calls "waiting" `wait` in `clean()`. */
const bullState = (s: JobState): string => (s === 'waiting' ? 'wait' : s)

const isBull = (q: unknown): q is BullQueue =>
  !!q &&
  typeof (q as BullQueue).getJobs === 'function' &&
  typeof (q as BullQueue).getJob === 'function'

function summary(job: BullJob, state: JobState): JobSummary {
  return {
    id: String(job.id),
    name: job.name,
    state,
    attempts: job.attemptsMade,
    maxAttempts: job.opts?.attempts,
    createdAt: job.timestamp,
    finishedAt: job.finishedOn,
    failedReason: job.failedReason || undefined,
  }
}

export function bullmqInspector(
  names: () => string[],
  getQueue: (name: string) => unknown,
): JobInspector {
  const queue = (name: string): BullQueue => {
    const q = getQueue(name)
    if (!isBull(q)) {
      throw new Error(`Queue "${name}" can't be browsed — its provider keeps no job history`)
    }
    return q
  }
  const job = async (queueName: string, id: string): Promise<BullJob> => {
    const found = await queue(queueName).getJob(id)
    if (!found) throw new Error(`Job ${id} not found in "${queueName}"`)
    return found
  }

  return {
    async queues(): Promise<JobQueueInfo[]> {
      return Promise.all(
        names().map(async (name) => {
          const q = getQueue(name)
          if (!isBull(q)) return { name, counts: {} }
          const [counts, paused] = await Promise.all([q.getJobCounts(...STATES), q.isPaused()])
          return { name, counts, paused }
        }),
      )
    },
    async jobs(name, state, { start, end }) {
      const jobs = await queue(name).getJobs([state], start, end, false)
      return jobs.map((j) => summary(j, state))
    },
    async job(name, id): Promise<JobDetail | null> {
      const j = await queue(name).getJob(id)
      if (!j) return null
      return {
        ...summary(j, (await j.getState()) as JobState),
        data: j.data,
        result: j.returnvalue,
        stacktrace: j.stacktrace?.length ? j.stacktrace : undefined,
        processedAt: j.processedOn,
        delayMs: j.delay || undefined,
        progress: j.progress,
        options: j.opts,
      }
    },
    retry: async (name, id) => (await job(name, id)).retry(),
    remove: async (name, id) => (await job(name, id)).remove(),
    retryAll: (name) => queue(name).retryJobs({ state: 'failed' }),
    clean: async (name, state) => (await queue(name).clean(0, 10_000, bullState(state))).length,
    pause: (name) => queue(name).pause(),
    resume: (name) => queue(name).resume(),
  }
}
