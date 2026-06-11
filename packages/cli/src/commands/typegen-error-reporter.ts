/**
 * Deduplicating reporter for typegen failures in `kick dev` watch mode.
 *
 * The watch pipeline used to swallow errors entirely (`.catch(() => {})`),
 * which left adopters debugging stale `.kickjs/types` with no signal.
 * This reporter warns on every NEW failure message per source, stays
 * quiet for repeats of the same message (each save in a broken state
 * would otherwise re-print it), and re-arms once the source succeeds
 * again so a recurring failure after a fix re-warns.
 */
export interface TypegenErrorReporter {
  /** Report a failure for `source`; emits only if the message changed. */
  report(source: string, err: unknown): void
  /** Mark `source` healthy — the next failure emits even if identical. */
  clear(source: string): void
}

export function createTypegenErrorReporter(emit: (message: string) => void): TypegenErrorReporter {
  const lastMessage = new Map<string, string>()
  return {
    report(source, err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (lastMessage.get(source) === msg) return
      lastMessage.set(source, msg)
      emit(`  kick typegen: ${source} pass failed (${msg}) — types in .kickjs/types may be stale`)
    },
    clear(source) {
      lastMessage.delete(source)
    },
  }
}
