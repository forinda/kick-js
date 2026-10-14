import type { Request, Response, NextFunction } from 'express'
// core/errors directly (not the barrel) — keeps the edge-safe web entry
// graph free of the barrel's eager node:fs asset-manager import.
import { HttpException, HttpStatus } from '../../core/errors'
import { detectSchema, type KickSchema, type SchemaIssue } from '@forinda/kickjs-schema'

export interface ValidationSchema {
  body?: any
  query?: any
  params?: any
}

function toValidationException(
  issues: SchemaIssue[],
  message: string,
  useFirstIssueMessage: boolean,
): HttpException {
  const details = issues.map((i) => ({
    field: i.path.join('.') || '',
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
 *
 * Accepts any schema supported by `@forinda/kickjs-schema`:
 * - Zod schemas (auto-detected)
 * - Standard Schema v1 objects
 * - KickSchema instances (from adapters like fromZod, fromValibot, etc.)
 * - Plain validator functions
 *
 * Validation failures are forwarded via `next(err)` as an `HttpException`, so
 * they flow through the application's global error handler (`onError`) and
 * produce a uniform response envelope.
 */
export function validate(schema: ValidationSchema) {
  // Detected on the first request, not per request: detection walks every
  // registered adapter and allocates a wrapper. Not at construction either —
  // a custom adapter registered during boot must still be seen.
  let wrapped: { body?: KickSchema; query?: KickSchema; params?: KickSchema } | undefined
  const schemas = () =>
    (wrapped ??= {
      body: schema.body ? detectSchema(schema.body) : undefined,
      query: schema.query ? detectSchema(schema.query) : undefined,
      params: schema.params ? detectSchema(schema.params) : undefined,
    })

  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const { body, query, params } = schemas()
      if (body) {
        const result = body.safeParse(req.body)
        if (!result.success) {
          return next(toValidationException(result.issues, 'Validation failed', true))
        }
        req.body = result.data
      }

      if (query) {
        const result = query.safeParse(req.query)
        if (!result.success) {
          return next(toValidationException(result.issues, 'Invalid query parameters', false))
        }
        assignReqProperty(req, 'query', result.data)
      }

      if (params) {
        const result = params.safeParse(req.params)
        if (!result.success) {
          return next(toValidationException(result.issues, 'Invalid path parameters', false))
        }
        assignReqProperty(req, 'params', result.data)
      }

      next()
    } catch (err) {
      next(err)
    }
  }
}
