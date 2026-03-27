import type { RequestContext } from '@forinda/kickjs-http';
import { HttpException } from '@forinda/kickjs-core';

export interface AuthUser {
  id: string;
  email: string;
  globalRole: string;
}

/**
 * Get the authenticated user from the request.
 * Reads from ctx metadata (set by authBridgeMiddleware via ctx.set('user')).
 *
 * Since KickJS v1.2.5, ctx metadata is shared across all RequestContext
 * instances for the same request, so ctx.get() works across middleware → handler.
 */
export function getUser(ctx: RequestContext): AuthUser {
  const user = ctx.get<AuthUser>('user');
  if (!user) {
    throw HttpException.unauthorized('Authentication required');
  }

  return user;
}
