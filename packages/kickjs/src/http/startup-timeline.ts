/**
 * Where startup time goes: each phase of `setup()` / `start()`, and each
 * adapter hook on its own, so "boot got slow" points at a name.
 *
 * @module @forinda/kickjs/http/startup-timeline
 */

/** One timed step, in the order it ran. */
export interface StartupStep {
  /** A phase (`'modules'`, `'routes'`, `'listen'`) or `'<Adapter>.<hook>'`. */
  name: string
  ms: number
}

export interface StartupTimelineSnapshot {
  totalMs: number
  steps: readonly StartupStep[]
}

const round = (ms: number) => Math.round(ms * 10) / 10

export class StartupTimeline {
  private readonly began = performance.now()
  private last = this.began
  private readonly steps: StartupStep[] = []

  /** Close a phase: the time since the previous step ended. */
  mark(name: string): void {
    const now = performance.now()
    this.steps.push({ name, ms: round(now - this.last) })
    this.last = now
  }

  /** Time one unit of work (an adapter hook) as its own step. */
  async time<T>(name: string, run: () => T | Promise<T>): Promise<T> {
    // Whatever ran since the last step belongs to the enclosing phase, which
    // the next mark() closes — so it is not charged to this step.
    const started = performance.now()
    const before = this.last
    try {
      return await run()
    } finally {
      const now = performance.now()
      this.steps.push({ name, ms: round(now - started) })
      // The phase resumes after this step: keep its time before the step.
      this.last = now - (started - before)
    }
  }

  snapshot(): StartupTimelineSnapshot {
    return { totalMs: round(performance.now() - this.began), steps: [...this.steps] }
  }

  /** The `count` slowest steps, slowest first. */
  slowest(count: number): StartupStep[] {
    return this.steps.toSorted((a, b) => b.ms - a.ms).slice(0, count)
  }
}
