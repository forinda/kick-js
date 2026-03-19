/**
 * Joi validation middleware — replaces the built-in Zod validate().
 *
 * The built-in validate() middleware calls .safeParse() which is Zod-specific.
 * This middleware does the same thing but uses Joi's .validate() method.
 */
import type { Request, Response, NextFunction } from 'express'
import type Joi from 'joi'

interface JoiValidationSchema {
  body?: Joi.Schema
  query?: Joi.Schema
  params?: Joi.Schema
}

export function joiValidate(schema: JoiValidationSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (schema.body) {
      const { error, value } = schema.body.validate(req.body, { abortEarly: false })
      if (error) {
        return res.status(422).json({
          message: error.details[0]?.message || 'Validation failed',
          errors: error.details.map((d) => ({
            field: d.path.join('.'),
            message: d.message,
          })),
        })
      }
      req.body = value
    }

    if (schema.query) {
      const { error, value } = schema.query.validate(req.query, { abortEarly: false })
      if (error) {
        return res.status(422).json({
          message: 'Invalid query parameters',
          errors: error.details.map((d) => ({
            field: d.path.join('.'),
            message: d.message,
          })),
        })
      }
      ;(req as any).query = value
    }

    if (schema.params) {
      const { error, value } = schema.params.validate(req.params, { abortEarly: false })
      if (error) {
        return res.status(422).json({
          message: 'Invalid path parameters',
          errors: error.details.map((d) => ({
            field: d.path.join('.'),
            message: d.message,
          })),
        })
      }
      ;(req as any).params = value
    }

    next()
  }
}
