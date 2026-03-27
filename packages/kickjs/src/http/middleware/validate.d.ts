import type { Request, Response, NextFunction } from 'express'
export interface ValidationSchema {
  body?: any
  query?: any
  params?: any
}
/**
 * Express middleware that validates request body/query/params against schemas.
 * Works with any validation library that exposes `.safeParse(data)` returning
 * `{ success: true, data }` or `{ success: false, error: { issues } }`.
 */
export declare function validate(
  schema: ValidationSchema,
): (
  req: Request,
  res: Response,
  next: NextFunction,
) => Response<any, Record<string, any>> | undefined
//# sourceMappingURL=validate.d.ts.map
