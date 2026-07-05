/**
 * Registry for framework-owned resources that hold timers or other handles
 * outside the adapter/plugin lifecycle — e.g. the in-memory session and
 * rate-limit stores' cleanup intervals. `Application.shutdown()` drains it so
 * startup and shutdown stay symmetric even for resources created lazily by
 * middleware factories.
 *
 * Intervals are `.unref()`'d so they never wedge process exit — this registry
 * exists for IN-PROCESS teardown (test suites, HMR, multi-app hosts) where
 * each un-disposed store would otherwise leak a live interval + backing Map
 * per app instance.
 */

export type Disposable = () => void | Promise<void>

const disposables = new Set<Disposable>()

/** Register a cleanup callback. Returns an unregister function. */
export function registerDisposable(fn: Disposable): () => void {
  disposables.add(fn)
  return () => disposables.delete(fn)
}

/**
 * Remove and return all currently registered disposables WITHOUT running
 * them. Used by HMR rebuild to snapshot the outgoing app's resources before
 * `setup()` registers the incoming app's — so the stale set can be disposed
 * on success, or restored on failure, without touching the new one.
 */
export function drainDisposables(): Disposable[] {
  const pending = [...disposables]
  disposables.clear()
  return pending
}

/**
 * Run a list of disposables. Errors — including SYNCHRONOUS throws — are
 * swallowed per-entry: the `async` callback converts a sync throw into a
 * rejection that `allSettled` absorbs, so one bad disposable can't abort
 * the rest (a bare `Promise.resolve(fn())` would let the throw escape the
 * `.map()` before `allSettled` ever ran).
 */
export async function runDisposables(list: Disposable[]): Promise<void> {
  await Promise.allSettled(list.map(async (fn) => fn()))
}

/** Run and clear all registered disposables. Errors are swallowed per-entry. */
export async function disposeAll(): Promise<void> {
  await runDisposables(drainDisposables())
}
