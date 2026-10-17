// Engine-neutral web pipeline: run one KickJS RouteEntry against a WHATWG
// Request and produce a WHATWG Response. Shared by the h3 v2 runtime
// (node bootstrap) and the `@forinda/kickjs/web` fetch entry (edge/Bun/Deno).
// Edge-safe: no node imports beyond the sanctioned ALS request store.

import { HttpException } from '../../core/errors'
import {
  DEFAULT_BODY_LIMIT,
  classifyMediaType,
  parseByteSize,
  formFields,
  hasPrototypeKey,
  parseForm,
  prototypeKeyError,
  readBodyBytes,
  readBodyText,
  unsupportedMediaTypeError,
} from '../body-policy'
import { RequestContext } from '../context'
import { publishMatchedRoute } from '../runtime'
import { applyHandlerResult } from '../reply'
import { requestStore } from '../request-store'
import { createRequestStore, disposeRequestStore } from '../middleware/request-scope'
import { validate } from '../middleware/validate'
import {
  applyUploadConfig,
  tooManyFiles,
  uploadLimits,
  type RawUploadPart,
} from '../middleware/upload-config'
import type { RouteEntry, RuntimeResponse } from '../runtime'
import { WebRequestShim, WebResponseDriver } from './driver'
import { errorHandler, notFoundHandler } from '../middleware/error-handler'

const NOOP_NEXT = (): void => {}
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export interface WebRouteInvocation {
  request: Request
  url: URL
  params: Record<string, string>
  /**
   * The request object the app's connect middleware wrote to — the node
   * `req` behind a node server, the per-event shim on the fetch path.
   * Whatever it set (`session`, `user`, `requestId`, an adapter's symbol)
   * reads through on the route's request.
   */
  carry?: object
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

// The same handlers Express and Fastify answer with, so an error or a request
// nothing answered has one shape on every engine: RFC 9457 problem details,
// the error's own headers, `requestId` on a 500.
const builtInError = errorHandler()
const builtInNotFound = notFoundHandler()

function decodeParams(params: Record<string, string>): Record<string, string> {
  const decoded: Record<string, string> = {}
  for (const key in params) {
    const value = params[key]
    decoded[key] = value.includes('%') ? decodeURIComponent(value) : value
  }
  return decoded
}

/**
 * Compile a RouteEntry into a `(invocation) => Promise<Response>` function.
 * Everything derivable at route-build time (validator, upload config) is
 * hoisted here — per-request work is shim + store + pipeline only.
 */
/**
 * The route's request, with anything it does not set itself read from
 * `carry` — the object connect middleware wrote to. Writes stay on the route's
 * own request. A declared-but-unset field (`requestId`) counts as not set.
 */
export function readThrough(shim: WebRequestShim, carry: object): WebRequestShim {
  return new Proxy(shim, {
    get(target, prop, receiver) {
      const own = Reflect.get(target, prop, receiver)
      return own !== undefined ? own : Reflect.get(carry, prop, carry)
    },
    has(target, prop) {
      return Reflect.has(target, prop) || Reflect.has(carry, prop)
    },
  })
}

export function compileWebRoute(
  entry: RouteEntry,
  hooks?: WebRouteHooks,
  options: { bodyLimit?: number } = {},
): (invocation: WebRouteInvocation) => Promise<Response> {
  const bodyLimit = options.bodyLimit ?? parseByteSize(DEFAULT_BODY_LIMIT)
  const validator = entry.meta.validation
    ? validate(entry.meta.validation, { validationError: entry.validationError })
    : undefined
  const upload = entry.meta.upload && entry.meta.upload.mode !== 'none' ? entry.meta.upload : null

  return async ({ request, url, params, carry }) => {
    const shim = new WebRequestShim(request, url)
    const req = carry ? readThrough(shim, carry) : shim
    let bodyError: unknown
    // h3 hands params over still percent-encoded; Express and Fastify decode
    // them, so `/users/a%20b` must reach the handler as `'a b'` here too.
    try {
      req.params = decodeParams(params)
    } catch {
      req.params = params
      bodyError = HttpException.badRequest('Malformed URL parameter')
    }

    // Body: uploads consume the stream as FormData; everything else parses
    // by content-type.
    if (upload) {
      // Bounded before anything is parsed: the route's file budget plus room
      // for fields. Past it is a 413, held like a parse failure below.
      const limits = uploadLimits(upload)
      let form: FormData | undefined
      try {
        const bytes = await readBodyBytes(request, limits.total)
        const type = request.headers.get('content-type') ?? ''
        form = await new Response(bytes as unknown as ConstructorParameters<typeof Response>[0], {
          headers: { 'content-type': type },
        })
          .formData()
          .catch(() => undefined)
      } catch (err) {
        if (err instanceof HttpException) bodyError = err
      }
      if (form) {
        const rawParts: RawUploadPart[] = []
        const fields: Array<[string, string]> = []
        for (const [name, value] of form.entries()) {
          if (typeof value === 'string') {
            fields.push([name, value])
          } else {
            rawParts.push({
              fieldname: name,
              filename: value.name ?? '',
              mimetype: value.type || 'application/octet-stream',
              // A real Buffer where the runtime has one (Node, Bun, Deno), so
              // `file.buffer.toString()` is the content as on every other
              // engine — a bare Uint8Array stringifies as "80,78,71,…".
              buffer: (typeof Buffer === 'function'
                ? Buffer.from(await value.arrayBuffer())
                : new Uint8Array(await value.arrayBuffer())) as unknown as Buffer,
            })
          }
        }
        req.body = formFields(fields)
        // A refused type (415), an oversized file or too many (413) is held like
        // a parse failure — thrown before the driver exists, it would escape the
        // route and reach the client as the host's bare error, not kick's.
        if (rawParts.length > limits.files) {
          bodyError = tooManyFiles(limits.files)
        } else {
          try {
            const { file, files } = applyUploadConfig(rawParts, entry.meta.upload!)
            req.file = file
            req.files = files
          } catch (err) {
            bodyError = err
          }
        }
      }
    } else if (BODY_METHODS.has(request.method)) {
      // Read once — a Request body is a stream and cannot be consumed twice.
      // A read that fails (client aborted mid-flight) is treated as an absent
      // body: there is nobody left to answer, and it is not a malformed one.
      // Past the limit is a 413, held like a parse failure below.
      let raw = ''
      try {
        raw = await readBodyText(request, bodyLimit)
      } catch (err) {
        if (err instanceof HttpException) bodyError = err
      }

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
          req.body = parseForm(raw)
        } else {
          req.body = raw
        }
      }
    }

    // A key that could rewrite a prototype — refused before any of the app's code sees it.
    if (!bodyError && hasPrototypeKey(req.body)) bodyError = prototypeKeyError()

    // Reuse the id `requestId()` middleware already gave the request, so the
    // response header, the route's ctx and observers agree on one id.
    const store = createRequestStore(req.requestId || req.headers['x-request-id'])
    req.requestId = store.requestId

    const driver = new WebResponseDriver(request.signal)
    driver.setHeader('x-request-id', store.requestId)

    publishMatchedRoute(req, entry)
    // Middleware that reports after the response (observers, request logger)
    // reads the route off the request it was handed — the carried one.
    if (carry) publishMatchedRoute(carry, entry)

    const pipeline = requestStore.run(store, async () => {
      if (bodyError) throw bodyError

      const ctx = new RequestContext(
        req as never,
        driver as never,
        NOOP_NEXT,
        driver as RuntimeResponse,
      )

      // `beforeValidation` contributors (#677) — ahead of validation and middleware.
      if (entry.earlyContributorRunner) {
        await entry.earlyContributorRunner(ctx)
        if (driver.settled) return
      }

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
      if (!driver.settled) await applyHandlerResult(ctx, result)
    })

    try {
      // Streaming responses resolve `ready` mid-pipeline (SSE); buffered ones
      // resolve at the terminal ctx call. Race so both shapes return promptly.
      try {
        await Promise.race([pipeline, driver.ready])
      } catch (err) {
        if (!driver.settled) {
          if (hooks?.onError) await hooks.onError(err, req, driver)
          if (!driver.settled) await builtInError(err, req, driver, NOOP_NEXT)
        }
      }
      if (!driver.settled) {
        // Pipeline finished without responding — the catch-all's 404.
        builtInNotFound(req, driver, NOOP_NEXT)
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
