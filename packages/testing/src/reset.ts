/**
 * Test state that outlives a test: in-memory fakes, caches, module-level
 * maps. Register a reset once, next to the thing it resets; `useTestApp`
 * runs them between test files (or tests), and `resetTestState()` runs them
 * anywhere else.
 *
 *   export const sentEmails: Email[] = []
 *   onTestReset(() => { sentEmails.length = 0 })
 */
const resets = new Set<() => unknown>()

/** Register a reset; returns a function that unregisters it. */
export function onTestReset(reset: () => unknown): () => void {
  resets.add(reset)
  return () => resets.delete(reset)
}

/** Run every registered reset, in registration order. All run even if one throws. */
export async function resetTestState(): Promise<void> {
  const errors: unknown[] = []
  for (const reset of resets) {
    try {
      await reset()
    } catch (err) {
      errors.push(err)
    }
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, `${errors.length} test resets failed`)
}
