/**
 * The last N requests the app answered, for the dashboard's Requests tab.
 *
 * Fed by the adapter's `onResponse` / `onError` hooks. An error is matched
 * to its request by `requestId`, whichever of the two hooks fires first.
 *
 * @module @forinda/kickjs-devtools/request-log
 */

export interface RequestLogEntry {
  /** Increasing per entry — the dashboard asks for entries after the last one it has. */
  seq: number
  /** When the response finished, ms since epoch. */
  at: number
  method: string
  path: string
  /** Matched route pattern; absent for unmatched requests. */
  route?: string
  status: number
  durationMs: number
  requestId?: string
  /** The error the request failed with, when one was reported. */
  error?: { name: string; message: string }
}

type Response = Pick<
  RequestLogEntry,
  'method' | 'path' | 'route' | 'status' | 'durationMs' | 'requestId'
>

/** Errors waiting for their response, keyed by request id — bounded like the log. */
const MAX_PENDING_ERRORS = 100

export class RequestLog {
  private entries: RequestLogEntry[] = []
  private pendingErrors = new Map<string, RequestLogEntry['error']>()
  private seq = 0

  constructor(private readonly capacity: number) {}

  record(info: Response, now = Date.now()): void {
    if (this.capacity <= 0) return
    const entry: RequestLogEntry = { seq: ++this.seq, at: now, ...info }
    if (info.requestId && this.pendingErrors.has(info.requestId)) {
      entry.error = this.pendingErrors.get(info.requestId)
      this.pendingErrors.delete(info.requestId)
    }
    this.entries.push(entry)
    if (this.entries.length > this.capacity) this.entries.shift()
  }

  recordError(requestId: string | undefined, err: unknown): void {
    if (this.capacity <= 0 || !requestId) return
    const error =
      err instanceof Error
        ? { name: err.name, message: err.message }
        : { name: 'Error', message: String(err) }
    // Response already logged — attach to it; otherwise hold until it is.
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i]!.requestId === requestId) {
        this.entries[i]!.error = error
        return
      }
    }
    this.pendingErrors.set(requestId, error)
    if (this.pendingErrors.size > MAX_PENDING_ERRORS) {
      this.pendingErrors.delete(this.pendingErrors.keys().next().value!)
    }
  }

  /** Entries after `since`, oldest first. */
  after(since = 0): RequestLogEntry[] {
    return this.entries.filter((e) => e.seq > since)
  }
}
