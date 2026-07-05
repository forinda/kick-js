// Engine-neutral web pipeline: run one KickJS RouteEntry against a WHATWG
// Request and produce a WHATWG Response. Shared by the h3 v2 runtime
// (node bootstrap) and the `@forinda/kickjs/web` fetch entry (edge/Bun/Deno).
// Edge-safe: no node imports beyond the sanctioned ALS request store.

import { RequestContext } from '../context'
import { requestStore } from '../request-store'
import { createRequestStore, disposeRequestStore } from '../middleware/request-scope'
import { validate } from '../middleware/validate'
import { applyUploadConfig, type RawUploadPart } from '../middleware/upload'
import type { RouteEntry, RuntimeResponse } from '../runtime'
import { WebRequestShim, WebResponseDriver } from './driver'

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

/** Fallback error shape when no engine error handler settles the response. */
function defaultErrorResponse(err: unknown, driver: WebResponseDriver): void {
  const status =
    typeof (err as { status?: number })?.status === 'number'
      ? (err as { status: number }).status
      : typeof (err as { statusCode?: number })?.statusCode === 'number'
        ? (err as { statusCode: number }).statusCode
        : 500
  const message =
    status >= 500 ? 'Internal Server Error' : ((err as Error)?.message ?? 'Request failed')
  driver.status(status).json({ error: message })
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

    // Body: uploads consume the stream as FormData; everything else parses
    // by content-type. A failed parse leaves body undefined (validation
    // rejects it downstream if the route demands a shape).
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
      const contentType = req.headers['content-type'] ?? ''
      if (contentType.includes('application/json')) {
        req.body = await request.json().catch(() => undefined)
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        const text = await request.text().catch(() => '')
        req.body = Object.fromEntries(new URLSearchParams(text))
      } else if (contentType.startsWith('text/')) {
        req.body = await request.text().catch(() => undefined)
      }
    }

    const store = createRequestStore(req.headers['x-request-id'])
    req.requestId = store.requestId

    const driver = new WebResponseDriver(request.signal)
    driver.setHeader('x-request-id', store.requestId)

    const pipeline = requestStore.run(store, async () => {
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
      await entry.handler(ctx)
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
