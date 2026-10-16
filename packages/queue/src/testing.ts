/**
 * `@forinda/kickjs-queue/testing` — an in-process queue for tests.
 *
 * `MemoryQueueProvider` runs `@Process` handlers in the same process, with
 * BullMQ's job options that matter in a test (`attempts`, `backoff`, `delay`),
 * `job.updateProgress()`, and the handler's return value on the job. Nothing
 * is persisted, so it is not a production backend.
 *
 * ```ts
 * const queue = new MemoryQueueProvider()
 * const app = await createTestApp({ modules, adapters: [QueueAdapter({ provider: queue })] })
 * await app.container.resolve(JOB_DISPATCHER).dispatch('email', 'welcome', { to: 'a@b.c' })
 * await queue.drain()
 * expect(queue.jobs('email')[0]).toMatchObject({ state: 'completed', returnvalue: 'sent' })
 * ```
 */
import type { QueueProvider } from './types'

/** What a test needs from BullMQ's `JobsOptions`. */
export interface MemoryJobOptions {
  /** Total tries, the first one included (default 1). */
  attempts?: number
  /** Milliseconds to wait before the first run. */
  delay?: number
  /** Milliseconds between tries — a number, or BullMQ's `{ delay }` (fixed only). */
  backoff?: number | { delay?: number }
  /** Use this id instead of a generated one. */
  jobId?: string
}

export type MemoryJobState = 'waiting' | 'delayed' | 'active' | 'completed' | 'failed'

/** A job in a {@link MemoryQueueProvider} — what its handler receives, and what a test reads. */
export interface MemoryJob<Data = any> {
  id: string
  queue: string
  name: string
  data: Data
  opts: MemoryJobOptions
  state: MemoryJobState
  /** Tries that have finished, failed ones included. */
  attemptsMade: number
  progress: unknown
  /** The handler's return value, once completed. */
  returnvalue?: unknown
  /** The last error's message, once a try has failed. */
  failedReason?: string
  updateProgress(progress: unknown): Promise<void>
}

type Processor = (job: MemoryJob) => Promise<unknown>

/** An in-process {@link QueueProvider} for tests. See the module docs. */
export class MemoryQueueProvider implements QueueProvider {
  private readonly all: MemoryJob[] = []
  private readonly processors = new Map<string, Processor>()
  private readonly running = new Set<Promise<void>>()
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()
  private nextId = 1
  private closed = false

  async addJob(queue: string, name: string, data: any, opts: MemoryJobOptions = {}) {
    const job: MemoryJob = {
      id: opts.jobId ?? String(this.nextId++),
      queue,
      name,
      data,
      opts,
      state: opts.delay ? 'delayed' : 'waiting',
      attemptsMade: 0,
      progress: 0,
      async updateProgress(progress) {
        job.progress = progress
      },
    }
    this.all.push(job)
    this.schedule(job, opts.delay ?? 0)
    return job
  }

  async addBulk(queue: string, jobs: Array<{ name: string; data: any; opts?: MemoryJobOptions }>) {
    return Promise.all(jobs.map((j) => this.addJob(queue, j.name, j.data, j.opts)))
  }

  // ponytail: no concurrency limit — every ready job runs at once; add a per-queue
  // limit if a test needs to observe ordering under `concurrency`.
  createWorker(queue: string, processor: Processor) {
    this.processors.set(queue, processor)
    // Jobs dispatched before the worker existed run now.
    for (const job of this.all) {
      if (job.queue === queue && job.state === 'waiting') this.schedule(job, 0)
    }
  }

  getQueue(name: string) {
    return { name, type: 'memory' }
  }

  /** Always reachable — it is this process. */
  async ping() {}

  /** Every job, or one queue's, in the order added. */
  jobs(queue?: string): MemoryJob[] {
    return queue === undefined ? [...this.all] : this.all.filter((j) => j.queue === queue)
  }

  /** A job by id. */
  getJob(id: string): MemoryJob | undefined {
    return this.all.find((j) => j.id === id)
  }

  /**
   * Resolve once nothing is running or waiting on a delay/backoff timer.
   * Jobs on a queue with no worker stay `waiting` and don't hold it up.
   * Under fake timers, advance them instead.
   */
  async drain(): Promise<void> {
    while (this.running.size > 0 || this.timers.size > 0) {
      await Promise.race([...this.running, new Promise((r) => setTimeout(r, 1))])
    }
  }

  async shutdown() {
    this.closed = true
    for (const t of this.timers) clearTimeout(t)
    this.timers.clear()
    await Promise.allSettled(this.running)
  }

  private schedule(job: MemoryJob, delay: number) {
    if (this.closed) return
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      const run = this.run(job).finally(() => this.running.delete(run))
      this.running.add(run)
    }, delay)
    this.timers.add(timer)
  }

  private async run(job: MemoryJob) {
    const processor = this.processors.get(job.queue)
    if (this.closed) return
    // No worker yet (or an API-only app): it waits for createWorker().
    if (!processor) return void (job.state = 'waiting')
    job.state = 'active'
    try {
      job.returnvalue = await processor(job)
      job.attemptsMade++
      job.state = 'completed'
    } catch (err) {
      job.attemptsMade++
      job.failedReason = err instanceof Error ? err.message : String(err)
      if (job.attemptsMade < (job.opts.attempts ?? 1)) {
        const { backoff } = job.opts
        job.state = 'delayed'
        this.schedule(job, typeof backoff === 'number' ? backoff : (backoff?.delay ?? 0))
      } else {
        job.state = 'failed'
      }
    }
  }
}
