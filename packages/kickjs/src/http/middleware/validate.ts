import type { Request, Response, NextFunction } from 'express'
import { HttpException, HttpStatus } from '../../core'

export interface ValidationSchema {
  body?: any
  query?: any
  params?: any
}

function toValidationException(
  error: any,
  message: string,
  useFirstIssueMessage: boolean,
): HttpException {
  const issues = error.issues || []
  const details = issues.map((i: any) => ({
    field: i.path?.join('.') ?? '',
    message: i.message,
  }))
  const finalMessage = useFirstIssueMessage ? (issues[0]?.message ?? message) : message
  return new HttpException(HttpStatus.UNPROCESSABLE_ENTITY, finalMessage, details)
}

/**
 * Express 5 installs `req.query` as a getter-only property (so pluggable
 * `query parser` functions can run lazily). Direct assignment throws in
 * strict mode: `Cannot set property query of #<IncomingMessage> which
 * has only a getter`. `Object.defineProperty` replaces the getter with
 * a plain value slot and sidesteps the throw. Used for `query` and
 * defensively for `params` too — Express 5 currently leaves `params`
 * writable, but swapping the descriptor costs the same and future-proofs
 * against upstream changes.
 */
function assignReqProperty(req: Request, key: 'query' | 'params', value: unknown): void {
  Object.defineProperty(req, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  })
}

/**
 * Express middleware that validates request body/query/params against schemas.
 * Works with any validation library that exposes `.safeParse(data)` returning
 * `{ success: true, data }` or `{ success: false, error: { issues } }`.
 *
 * Validation failures are forwarded via `next(err)` as an `HttpException`, so
 * they flow through the application's global error handler (`onError`) and
 * produce a uniform response envelope. Apps that keep the built-in handler
 * continue to see the same `{ message, errors: [{ field, message }] }` body.
 */
export function validate(schema: ValidationSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schema.body) {
        const result = schema.body.safeParse(req.body)
        if (!result.success) {
          return next(toValidationException(result.error, 'Validation failed', true))
        }
        req.body = result.data
      }

      if (schema.query) {
        const result = schema.query.safeParse(req.query)
        if (!result.success) {
          return next(toValidationException(result.error, 'Invalid query parameters', false))
        }
        assignReqProperty(req, 'query', result.data)
      }

      if (schema.params) {
        const result = schema.params.safeParse(req.params)
        if (!result.success) {
          return next(toValidationException(result.error, 'Invalid path parameters', false))
        }
        assignReqProperty(req, 'params', result.data)
      }

      next()
    } catch (err) {
      next(err)
    }
  }
}
