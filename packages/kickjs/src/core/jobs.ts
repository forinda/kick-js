/**
 * Background jobs, with whatever runs them.
 *
 * `@Job(queue)` / `@Process(name)` only record which method handles which
 * job — the same way `@Cron` only records a schedule. Any job tool turns that
 * into running code in a few lines: subscribe to each queue from
 * {@link listJobQueues}, and hand every job it receives to {@link runJob}.
 *
 *   @Job('email')
 *   export class EmailJobs {
 *     @Process('welcome')
 *     async welcome(job: JobLike<{ to: string }>) { await sendWelcome(job.data.to) }
 *   }
 *
 * Enqueueing goes through {@link JOB_DISPATCHER}, which the active adapter
 * provides — code that dispatches never names the tool.
 *
 * `@forinda/kickjs-queue` ships a BullMQ adapter (plus RabbitMQ / Kafka /
 * Redis pub-sub providers); the web entry's `queue()` runs Cloudflare Queues.
 */
import { Service } from './decorators'
import { getClassMeta, getClassMetaOrUndefined, pushClassMeta, setClassMeta } from './metadata'
import { reportError } from './observers'
import { createLogger } from './logger'
import { createToken } from './token'

const log = createLogger('KickJobs')

/** Metadata keys — the same ones `@forinda/kickjs-queue` used, so existing readers keep working. */
export const JOB_META = {
  JOB: 'kick/queue/job',
  PROCESS: 'kick/queue/process',
} as const

/** What a `@Process` method records. */
export interface ProcessDefinition {
  /** Method name on the class. */
  handlerName: string
  /** Job name it handles; `undefined` handles every job in the queue. */
  jobName?: string
}

/**
 * The least a job tool hands over. Runners pass their own job object through
 * unchanged — BullMQ's `Job`, a Cloudflare message — so a handler can still
 * reach tool-specific fields (`job.attemptsMade`, `job.updateProgress()`).
 */
export interface JobLike<Data = unknown> {
  name: string
  data: Data
  id?: string
}

/**
 * Every `@Job` class, keyed by class name like the DI registry: an HMR
 * re-evaluation replaces the old class instead of leaving both subscribed.
 */
const jobClasses = new Map<string, Function>()

/** Mark a class as handling jobs on `queue`. The class is a DI singleton. */
export function Job(queue: string): ClassDecorator {
  return (target) => {
    Service()(target)
    setClassMeta(JOB_META.JOB, queue, target)
    jobClasses.set(target.name, target)
  }
}

/** Mark a method as handling `jobName` — or, without a name, every job its queue gets. */
export function Process(jobName?: string): MethodDecorator {
  return (target, propertyKey) => {
    pushClassMeta<ProcessDefinition>(JOB_META.PROCESS, target.constructor, {
      handlerName: propertyKey as string,
      jobName,
    })
  }
}

/** One handler: its queue, job name (absent for a catch-all), class and method. */
export interface JobHandler extends ProcessDefinition {
  queue: string
  target: Function
}

/**
 * Every `@Process` method of a `@Job` class the container can resolve.
 * Classes it doesn't know (not in a module, or from before an HMR reload)
 * are skipped.
 */
export function listJobHandlers(container: { has(token: unknown): boolean }): JobHandler[] {
  const handlers: JobHandler[] = []
  for (const target of jobClasses.values()) {
    if (!container.has(target)) continue
    const queue = getClassMetaOrUndefined<string>(JOB_META.JOB, target)
    if (queue === undefined) continue
    const processes = getClassMeta<ProcessDefinition[]>(JOB_META.PROCESS, target, [])
    if (processes.length === 0) {
      log.warn(`@Job('${queue}') class ${target.name} has no @Process methods`)
    }
    for (const process of processes) handlers.push({ ...process, queue, target })
  }
  return handlers
}

/** The queues something handles — what a runner subscribes to. */
export function listJobQueues(container: { has(token: unknown): boolean }): string[] {
  return [...new Set(listJobHandlers(container).map((h) => h.queue))]
}

/** Thrown when a queue receives a job no `@Process` method handles. */
export class NoJobHandlerError extends Error {
  constructor(
    readonly queue: string,
    readonly jobName: string,
  ) {
    super(`No @Process handler for job "${jobName}" on queue "${queue}"`)
    this.name = 'NoJobHandlerError'
  }
}

/**
 * Run one job: pick the `@Process` method for `job.name` (or the queue's
 * catch-all), resolve its class from the container and call it with `job`
 * as given. A failure is reported to the error observers (`source: 'job'`)
 * and rethrown, so the tool's own retry and dead-letter handling still
 * applies. A job nothing handles throws {@link NoJobHandlerError} rather
 * than being acknowledged and lost.
 */
export async function runJob(
  container: { has(token: unknown): boolean; resolve(token: unknown): unknown },
  queue: string,
  job: JobLike,
  /** Extra fields for the error report — e.g. the tool's attempt count. */
  report: Record<string, unknown> = {},
): Promise<unknown> {
  const handlers = listJobHandlers(container).filter((h) => h.queue === queue)
  const handler =
    handlers.find((h) => h.jobName === job.name) ?? handlers.find((h) => h.jobName === undefined)
  try {
    if (!handler) throw new NoJobHandlerError(queue, job.name)
    const instance = container.resolve(handler.target) as Record<string, (j: JobLike) => unknown>
    return await instance[handler.handlerName]!(job)
  } catch (err) {
    log.error({ err }, `Job ${queue}/${job.name} failed`)
    reportError(err, { source: 'job', context: { queue, job: job.name, id: job.id, ...report } })
    throw err
  }
}

/** Enqueue a job — implemented by whichever adapter runs the jobs. */
export interface JobDispatcher {
  dispatch<Data = unknown>(
    queue: string,
    name: string,
    data: Data,
    options?: Record<string, unknown>,
  ): Promise<unknown>
}

/**
 * The active job dispatcher. Inject it to enqueue without naming the tool:
 * `@Inject(JOB_DISPATCHER) private jobs!: JobDispatcher`.
 */
export const JOB_DISPATCHER = createToken<JobDispatcher>('kick/jobs/Dispatcher')
