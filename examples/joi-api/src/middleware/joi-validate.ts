/**
 * Joi validation middleware — replaces the built-in Zod validate().
 *
 * Returns a KickJS MiddlewareHandler (ctx, next) so it works with @Middleware.
 * The built-in validate() uses Zod's .safeParse() — this uses Joi's .validate().
 */
import type Joi from 'joi'
import type { MiddlewareHandler } from '@forinda/kickjs-core'

interface JoiValidationSchema {
  body?: Joi.Schema
  query?: Joi.Schema
  params?: Joi.Schema
}

export function joiValidate(schema: JoiValidationSchema): MiddlewareHandler {
  return (ctx, next) => {
    if (schema.body) {
      const { error, value } = schema.body.validate(ctx.req.body, { abortEarly: false })
      if (error) {
        return ctx.res.status(422).json({
          message: error.details[0]?.message || 'Validation failed',
          errors: error.details.map((d) => ({
            field: d.path.join('.'),
            message: d.message,
          })),
        })
      }
      ctx.req.body = value
    }

    if (schema.query) {
      const { error, value } = schema.query.validate(ctx.req.query, { abortEarly: false })
      if (error) {
        return ctx.res.status(422).json({
          message: 'Invalid query parameters',
          errors: error.details.map((d) => ({
            field: d.path.join('.'),
            message: d.message,
          })),
        })
      }
      ;(ctx.req as any).query = value
    }

    if (schema.params) {
      const { error, value } = schema.params.validate(ctx.req.params, { abortEarly: false })
      if (error) {
        return ctx.res.status(422).json({
          message: 'Invalid path parameters',
          errors: error.details.map((d) => ({
            field: d.path.join('.'),
            message: d.message,
          })),
        })
      }
      ;(ctx.req as any).params = value
    }

    next()
  }
}
