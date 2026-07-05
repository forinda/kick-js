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

/** Run and clear all registered disposables. Errors are swallowed per-entry. */
export async function disposeAll(): Promise<void> {
  const pending = [...disposables]
  disposables.clear()
  await Promise.allSettled(pending.map((fn) => Promise.resolve(fn())))
}
