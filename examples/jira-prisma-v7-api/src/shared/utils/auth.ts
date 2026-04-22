import type { RequestContext } from '@forinda/kickjs'
import { HttpException } from '@forinda/kickjs'

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
