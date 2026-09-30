/**
 * One place every error and every response is reported to — so an error
 * tracker, a metrics exporter, or an APM integration hooks in once instead of
 * replacing the error handler and patching each source.
 *
 * Observers are adapters and plugins with `onError` / `onResponse`, plus
 * whatever the Node server's tracing channels publish (see `http/tracing.ts`).
 * Observe-only: they cannot change the response, and one that throws is
 * logged and skipped — it never breaks a request or another observer.
 *
 * Free of `node:` imports: `waitUntil` (shared with the web entry) reports
 * through here.
 *
 * @module @forinda/kickjs/core/observers
 */
import { createLogger } from './logger'

const log = createLogger('Observers')

/** Where an error came from. Integrations may report their own sources. */
export type ErrorSource =
  | 'request'
  | 'uncaught'
  | 'unhandled-rejection'
  | 'background'
  | 'job'
  | (string & {})

export interface ErrorInfo {
  source: ErrorSource
  requestId?: string
  method?: string
  /** The request URL path, as received. */
  path?: string
  /** The matched route pattern, e.g. `/api/v1/users/:id`, when one matched. */
  route?: string
  /** The status the error was answered with, for request errors. */
  status?: number
  /** Anything else the reporter knows — a queue and job name, a cron schedule. */
  context?: Record<string, unknown>
}

export interface ResponseInfo {
  method: string
  path: string
  /** The matched route pattern, or undefined when no route matched (404s). */
  route?: string
  status: number
  durationMs: number
  requestId?: string
}

export interface Observer {
  name?: string
  onError?(error: unknown, info: ErrorInfo): void | Promise<void>
  onResponse?(info: ResponseInfo): void | Promise<void>
}

let observers: readonly Observer[] = []
let publisher: Observer | undefined
let publisherWantsResponses: () => boolean = () => false

/**
 * Replace the observer set — called by the Application from its adapters and
 * plugins. Returns the installed set, so its owner can later release exactly
 * that set (see {@link releaseObservers}).
 */
export function setObservers(list: readonly Observer[]): readonly Observer[] {
  observers = list.filter((o) => o.onError || o.onResponse)
  return observers
}

/**
 * Clear the observer set — but only if it is still the one `installed`. The
 * set is process-wide: a newer Application may have replaced it, and an older
 * one shutting down must not clear the newer one's observers.
 */
export function releaseObservers(installed: readonly Observer[]): void {
  if (observers === installed) observers = []
}

/**
 * The Node server's tracing channels, fed from the same reports. `wantsResponses`
 * is checked per request: a channel can gain a subscriber at any time.
 */
export function setObserverPublisher(
  next: Observer | undefined,
  wantsResponses: () => boolean = () => false,
): void {
  publisher = next
  publisherWantsResponses = wantsResponses
}

/** Whether anything is listening for responses — lets the server skip timing work. */
export function hasResponseObservers(): boolean {
  return observers.some((o) => o.onResponse) || publisherWantsResponses()
}

function notify(pick: (o: Observer) => void | Promise<void> | undefined, what: string): void {
  for (const observer of publisher ? [...observers, publisher] : observers) {
    try {
      const result = pick(observer)
      if (result && typeof (result as Promise<void>).catch === 'function') {
        ;(result as Promise<void>).catch((err: unknown) => failed(observer, what, err))
      }
    } catch (err) {
      failed(observer, what, err)
    }
  }
}

function failed(observer: Observer, what: string, err: unknown): void {
  // Logged directly, never re-reported: an observer failing inside onError
  // must not loop back into onError. Guarded too: a custom LoggerProvider that
  // throws would otherwise escape reportError() — or, from an async
  // observer, become an unhandled rejection that bootstrap reports right back
  // here.
  try {
    log.error({ err }, `${observer.name ?? 'observer'}.${what} threw — skipped`)
  } catch {
    // Nothing left to tell; reportError's "never throws" contract wins.
  }
}

/**
 * Report an error to every observer. The framework calls this for request
 * errors, uncaught exceptions, unhandled rejections, `waitUntil` failures and
 * queue job failures; call it from your own integrations too (a cron runner,
 * a message consumer). Never throws.
 */
export function reportError(error: unknown, info: ErrorInfo): void {
  notify((o) => o.onError?.(error, info), 'onError')
}

/** Report a finished response to every observer. Never throws. */
export function reportResponse(info: ResponseInfo): void {
  notify((o) => o.onResponse?.(info), 'onResponse')
}
