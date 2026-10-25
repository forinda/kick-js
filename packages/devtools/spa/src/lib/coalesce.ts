/**
 * Calls `fn` once, `ms` after the first of a burst of calls; calls made while
 * one is pending join it. `cancel()` drops a pending call.
 */
export function coalesce(fn: () => void, ms: number): { (): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  const run = () => {
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      fn()
    }, ms)
  }
  run.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }
  return run
}
