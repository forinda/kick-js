import type { MiddlewareHandler } from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'
import { HttpException } from '@forinda/kickjs-core'
import jwt from 'jsonwebtoken'
import { env } from '@/config/env'
import type { AuthUser } from '@/shared/utils/auth'

export const authBridgeMiddleware: MiddlewareHandler = (ctx: RequestContext, next) => {
  const header = ctx.req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    throw HttpException.unauthorized('Missing or invalid authorization header')
  }

  const token = header.slice(7)

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload
    const user: AuthUser = {
      id: payload.sub!,
      email: payload.email as string,
      globalRole: payload.globalRole as string,
    }
    ctx.set('user', user)
  } catch {
    throw HttpException.unauthorized('Invalid or expired token')
  }

  next()
}
