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

/** A request that failed route validation — what a `validationError` hook receives. */
export interface ValidationFailure {
  /** The part of the request that failed. */
  source: 'body' | 'query' | 'params'
  /** Every issue the schema reported, adapter-neutral (Zod, Valibot, Yup, …). */
  issues: SchemaIssue[]
  /** The request, as the runtime hands it to middleware. */
  req: unknown
}

/**
 * Turns a validation failure into the error the request fails with. Return
 * (or throw) any error — an `HttpException` or `ProblemException` keeps the
 * error handler's problem-details response — or return `undefined` to use
 * {@link defaultValidationError} for this one.
 */
export type ValidationErrorFactory = (failure: ValidationFailure) => unknown

/**
 * The built-in failure: 422 with `details` as `[{ field, message }]`. A body
 * failure leads with its first issue's message. `@forinda/kickjs-inertia`
 * reads these `details` for the page's `errors`, so a custom factory serving
 * Inertia pages should keep the shape — or call this and adjust the result.
 */
export function defaultValidationError({ source, issues }: ValidationFailure): HttpException {
  const details = issues.map((i) => ({
    field: i.path.join('.') || '',
    message: i.message,
  }))
  const message =
    source === 'body'
      ? (issues[0]?.message ?? 'Validation failed')
      : source === 'query'
        ? 'Invalid query parameters'
        : 'Invalid path parameters'
  return new HttpException(HttpStatus.UNPROCESSABLE_ENTITY, message, details)
}

// Process-wide, like the env resolver: set from `bootstrap({ validationError })`
// / `createWebApp({ validationError })`, read by every engine's validation.
let factory: ValidationErrorFactory | undefined

/** @internal Installed by Application and createWebApp; `undefined` restores the default. */
export function _setValidationErrorFactory(fn: ValidationErrorFactory | undefined): void {
  factory = fn
}

function validationError(failure: ValidationFailure): unknown {
  if (!factory) return defaultValidationError(failure)
  try {
    return factory(failure) ?? defaultValidationError(failure)
  } catch (thrown) {
    return thrown
  }
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
          return next(validationError({ source: 'body', issues: result.issues, req }))
        }
        req.body = result.data
      }

      if (query) {
        const result = query.safeParse(req.query)
        if (!result.success) {
          return next(validationError({ source: 'query', issues: result.issues, req }))
        }
        assignReqProperty(req, 'query', result.data)
      }

      if (params) {
        const result = params.safeParse(req.params)
        if (!result.success) {
          return next(validationError({ source: 'params', issues: result.issues, req }))
        }
        assignReqProperty(req, 'params', result.data)
      }

      next()
    } catch (err) {
      next(err)
    }
  }
}
