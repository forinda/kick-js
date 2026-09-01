// Engine-neutral web pipeline: run one KickJS RouteEntry against a WHATWG
// Request and produce a WHATWG Response. Shared by the h3 v2 runtime
// (node bootstrap) and the `@forinda/kickjs/web` fetch entry (edge/Bun/Deno).
// Edge-safe: no node imports beyond the sanctioned ALS request store.

import { HttpException } from '../../core/errors'
import { classifyMediaType, unsupportedMediaTypeError } from '../body-policy'
import { RequestContext } from '../context'
import { applyHandlerResult } from '../reply'
import { requestStore } from '../request-store'
import { createRequestStore, disposeRequestStore } from '../middleware/request-scope'
import { validate } from '../middleware/validate'
import { applyUploadConfig, type RawUploadPart } from '../middleware/upload-config'
import type { RouteEntry, RuntimeResponse } from '../runtime'
import { WebRequestShim, WebResponseDriver } from './driver'
import { createLogger, describeError } from '../../core/logger'

const log = createLogger('WebPipeline')
const NOOP_NEXT = (): void => {}
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export interface WebRouteInvocation {
  request: Request
  url: URL
  params: Record<string, string>
}

export interface WebRouteHooks {
  /**
   * Error bridge — receives pipeline rejections (validation failures,
   * handler throws) with the shim + driver so an engine can dispatch the
   * framework's connect-style error handler. When absent (or when it
   * doesn't settle the driver), a minimal JSON error is produced from
   * `err.status`/`err.statusCode` (500 default).
   */
  onError?: (err: unknown, req: WebRequestShim, res: WebResponseDriver) => void | Promise<void>
}

/**
 * Fallback error shape when no engine error handler settles the response.
 *
 * This path used to be completely silent: a bare
 * `{ error: 'Internal Server Error' }` with no log line anywhere, so a
 * failure that reached here left no trace on either side. It is a
 * last-resort branch, which is exactly when diagnostics matter most.
 */
function defaultErrorResponse(err: unknown, driver: WebResponseDriver): void {
  const status =
    typeof (err as { status?: number })?.status === 'number'
      ? (err as { status: number }).status
      : typeof (err as { statusCode?: number })?.statusCode === 'number'
        ? (err as { statusCode: number }).statusCode
        : 500

  if (status >= 500) {
    log.error(err, `Unhandled error in web pipeline — ${describeError(err)}`)
    const stack = (err as Error)?.stack
    driver.status(status).json({
      error: 'Internal Server Error',
      ...(isProduction()
        ? {}
        : {
            message: describeError(err),
            ...(typeof stack === 'string' ? { stack: stack.split('\n') } : {}),
          }),
    })
    return
  }

  driver.status(status).json({ error: (err as Error)?.message ?? 'Request failed' })
}

/**
 * Read per-call, not at module scope: the web entry is imported once and
 * reused across invocations, and edge runtimes may not expose `process`.
 */
function isProduction(): boolean {
  return typeof process !== 'undefined' && process.env?.NODE_ENV === 'production'
}

/**
 * Compile a RouteEntry into a `(invocation) => Promise<Response>` function.
 * Everything derivable at route-build time (validator, upload config) is
 * hoisted here — per-request work is shim + store + pipeline only.
 */
export function compileWebRoute(
  entry: RouteEntry,
  hooks?: WebRouteHooks,
): (invocation: WebRouteInvocation) => Promise<Response> {
  const validator = entry.meta.validation ? validate(entry.meta.validation) : undefined
  const upload = entry.meta.upload && entry.meta.upload.mode !== 'none' ? entry.meta.upload : null

  return async ({ request, url, params }) => {
    const req = new WebRequestShim(request, url)
    req.params = params
    let bodyError: unknown

    // Body: uploads consume the stream as FormData; everything else parses
    // by content-type.
    if (upload) {
      const form = await request.formData().catch(() => undefined)
      if (form) {
        const rawParts: RawUploadPart[] = []
        const fields: Record<string, unknown> = {}
        for (const [name, value] of form.entries()) {
          if (typeof value === 'string') {
            fields[name] = value
          } else {
            rawParts.push({
              fieldname: name,
              filename: value.name ?? '',
              mimetype: value.type || 'application/octet-stream',
              buffer: new Uint8Array(await value.arrayBuffer()) as unknown as Buffer,
            })
          }
        }
        const { file, files } = applyUploadConfig(rawParts, entry.meta.upload!)
        req.file = file
        req.files = files
        req.body = fields
      }
    } else if (BODY_METHODS.has(request.method)) {
      // Read once — a Request body is a stream and cannot be consumed twice.
      // A read that fails (client aborted mid-flight) is treated as an absent
      // body: there is nobody left to answer, and it is not a malformed one.
      const raw = request.body === null ? '' : await request.text().catch(() => '')

      // An empty body is ABSENT, not unparseable — the same call the node h3
      // runtime makes on `content-length: 0`. Distinguishing the two is the
      // whole point: `.catch(() => undefined)` around the parse could not,
      // so a malformed payload answered 200 with the handler running against
      // `undefined` (#605), the defect #586 removed from the node runtime.
      const kind = classifyMediaType(req.headers['content-type'])
      if (raw !== '' && kind === 'unsupported') {
        // Held for the same reason as a parse failure: no driver yet.
        bodyError = unsupportedMediaTypeError(req.headers['content-type'])
      } else if (raw !== '' && kind !== 'multipart') {
        if (kind === 'json') {
          try {
            req.body = JSON.parse(raw)
          } catch (err) {
            // Held, not thrown: the driver that turns an error into a response
            // does not exist yet, so throwing here escapes the route entirely
            // and surfaces as a 500. Rethrown as the pipeline's first act.
            bodyError = HttpException.badRequest(
              err instanceof Error ? err.message : 'Request body could not be parsed',
            )
          }
        } else if (kind === 'urlencoded') {
          req.body = Object.fromEntries(new URLSearchParams(raw))
        } else {
          req.body = raw
        }
      }
    }

    const store = createRequestStore(req.headers['x-request-id'])
    req.requestId = store.requestId

    const driver = new WebResponseDriver(request.signal)
    driver.setHeader('x-request-id', store.requestId)

    const pipeline = requestStore.run(store, async () => {
      if (bodyError) throw bodyError

      const ctx = new RequestContext(
        req as never,
        driver as never,
        NOOP_NEXT,
        driver as RuntimeResponse,
      )

      if (validator) {
        await new Promise<void>((resolve, reject) => {
          validator(req as never, undefined as never, (err?: unknown) =>
            err ? reject(err) : resolve(),
          )
        })
      }

      for (const mw of entry.middlewares) {
        let advanced = false
        await new Promise<void>((resolve, reject) => {
          const next = (err?: unknown): void => {
            advanced = true
            if (err) reject(err)
            else resolve()
          }
          Promise.resolve(mw(ctx, next)).catch(reject)
        })
        if (!advanced || driver.settled) return
      }

      if (entry.contributorRunner) await entry.contributorRunner(ctx)
      if (driver.settled) return
      const result = await entry.handler(ctx)
      // Return-value handlers (reply.ts): auto-send when nothing was written.
      // `undefined` falls through to the canonical 404 below.
      if (!driver.settled) applyHandlerResult(ctx, result)
    })

    try {
      // Streaming responses resolve `ready` mid-pipeline (SSE); buffered ones
      // resolve at the terminal ctx call. Race so both shapes return promptly.
      try {
        await Promise.race([pipeline, driver.ready])
      } catch (err) {
        if (!driver.settled) {
          if (hooks?.onError) await hooks.onError(err, req, driver)
          if (!driver.settled) defaultErrorResponse(err, driver)
        }
      }
      if (!driver.settled) {
        // Pipeline finished without responding — canonical 404 shape.
        driver.status(404).json({ error: 'Not Found' })
      }
      return await driver.ready
    } finally {
      // @PreDestroy teardown. For buffered responses this runs post-response;
      // for streams it runs when the pipeline (not the stream) completes —
      // stream lifetime is governed by the client abort signal.
      void Promise.resolve(pipeline)
        .catch(() => {})
        .then(() => disposeRequestStore(store))
    }
  }
}
