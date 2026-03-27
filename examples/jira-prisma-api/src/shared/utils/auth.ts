import type { RequestContext } from '@forinda/kickjs-http'
import { HttpException } from '@forinda/kickjs-core'

export interface AuthUser {
  id: string
  email: string
  globalRole: string
}

export function getUser(ctx: RequestContext): AuthUser {
  const user = ctx.get<AuthUser>('user')
  if (!user) {
    throw HttpException.unauthorized('Authentication required')
  }

  return user
}
