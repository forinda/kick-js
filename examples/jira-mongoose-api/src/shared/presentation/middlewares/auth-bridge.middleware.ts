import type { MiddlewareHandler } from '@forinda/kickjs';
import type { RequestContext } from '@forinda/kickjs';

/**
 * Validates JWT from the Authorization header and stores the authenticated
 * user in ctx metadata via ctx.set('user', ...).
 *
 * Since KickJS v1.2.5, ctx metadata is shared across all RequestContext
 * instances for the same request, so ctx.get('user') works in handlers.
 */
export const authBridgeMiddleware: MiddlewareHandler = (ctx: RequestContext, next) => {
  const user = (ctx.req as any).user;
  if (user) {
    ctx.set('user', user);
  }
  next();
};
