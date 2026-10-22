/**
 * Validation errors the browser-form way: a form post that fails route
 * validation goes back to the form, with each field's error and what was
 * typed kept in the session for the next page (`.kick` views read them as
 * `$errors` and `$old`). API calls and everything else go to the usual
 * error handler.
 *
 * @module @forinda/kickjs/http/middleware/form-errors
 */
import { HttpException } from '../../core/errors'
import { createLogger } from '../../core/logger'
import { FORM_ERRORS_KEY, OLD_INPUT_KEY, PREVIOUS_URL_KEY, fieldErrors, oldInput } from '../form'
import type { RuntimeResponse } from '../runtime'
import { errorHandler } from './error-handler'

const log = createLogger('Forms')

export type FormErrorHandler = (
  err: any,
  req: any,
  res: RuntimeResponse,
  next: (err?: unknown) => void,
) => unknown

interface SessionLike {
  data: Record<string, unknown>
  save(): Promise<void>
}

export interface FormErrorHandlerOptions {
  /** Where to go back to when the `Referer` is missing or another site's. Default `'/'`. */
  fallbackUrl?: string
}

const header = (req: any, name: string): string => String(req?.headers?.[name] ?? '')

/** A browser form submit: urlencoded or multipart, not an Inertia visit, navigating to HTML. */
function isFormPost(req: any): boolean {
  const method = String(req?.method ?? 'GET').toUpperCase()
  if (method === 'GET' || method === 'HEAD') return false
  if (header(req, 'x-inertia') === 'true') return false
  const type = header(req, 'content-type')
  if (!/application\/x-www-form-urlencoded|multipart\/form-data/i.test(type)) return false
  // A browser submitting a form asks for HTML and navigates; fetch() with
  // FormData sends `*/*` and wants the usual JSON answer.
  // Browsers that send Sec-Fetch-Mode say which: only `navigate` is a form.
  const mode = header(req, 'sec-fetch-mode')
  if (mode) return mode === 'navigate'
  return /text\/html/i.test(header(req, 'accept'))
}

/** A path on this site: one leading `/`, not `//` or `/\`. */
const ownPath = (path: string) => /^\/(?![/\\])/.test(path)

/** The same-origin `Referer`'s path and query, else `fallback`. */
function backUrl(req: any, fallback: string): string {
  const referer = header(req, 'referer')
  const host = header(req, 'host')
  if (!referer || !host) return fallback
  try {
    const url = new URL(referer)
    if (url.host !== host) return fallback
    // `//other.site` (or `/\other.site`) in a Location header is another
    // site, even when the Referer's own host was ours.
    const path = url.pathname + url.search
    return ownPath(path) ? path : fallback
  } catch {
    return fallback
  }
}

/**
 * Pass to `bootstrap({ onError: formErrorHandler() })`; with Inertia,
 * `inertiaErrorHandler(formErrorHandler())`. Needs the `session()` middleware
 * to carry the errors; without it, a failed form post gets the fallback's 422.
 */
export function formErrorHandler(
  fallback: FormErrorHandler = errorHandler(),
  options: FormErrorHandlerOptions = {},
): FormErrorHandler {
  const home = options.fallbackUrl ?? '/'
  let warnedSession = false
  let warnedSize = false
  return (err, req, res, next) => {
    if (res.headersSent) return fallback(err, req, res, next)
    const errors =
      err instanceof HttpException && err.status === 422 ? fieldErrors(err.details) : null
    if (!errors || !isFormPost(req)) return fallback(err, req, res, next)
    const session = req.session as SessionLike | undefined
    if (!session) {
      if (!warnedSession) {
        log.warn(
          'A form post failed validation, but there is no session() middleware to carry the errors back — answering 422 instead.',
        )
        warnedSession = true
      }
      return fallback(err, req, res, next)
    }
    session.data[FORM_ERRORS_KEY] = errors
    const old = oldInput(req.body)
    if (old) session.data[OLD_INPUT_KEY] = old
    else {
      delete session.data[OLD_INPUT_KEY]
      if (!warnedSize) {
        log.warn(
          'A failed form post sent more than a session can hold — its values are not kept for the form.',
        )
        warnedSize = true
      }
    }
    // Returned, so an engine that waits on async handlers waits on this.
    return session
      .save()
      .then(() => {
        // The last page this session rendered (helmet's default no-referrer
        // policy leaves no Referer), else the Referer, else the fallback.
        const previous = session.data[PREVIOUS_URL_KEY]
        const back =
          typeof previous === 'string' && ownPath(previous) ? previous : backUrl(req, home)
        res.status(303).setHeader('location', back)
        res.end()
      })
      .catch((saveErr) => fallback(saveErr, req, res, next))
  }
}
