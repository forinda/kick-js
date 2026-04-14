import type { AuthUser } from './types'

/**
 * Log a user in by storing their data in the session.
 *
 * Regenerates the session ID to prevent session fixation attacks,
 * then merges the user data into `session.data` and persists it.
 *
 * Requires the KickJS session middleware to be configured.
 *
 * @param session - The `ctx.session` object from RequestContext
 * @param user - The authenticated user to store
 *
 * @example
 * ```ts
 * @Post('/login')
 * @Public()
 * async login(ctx: RequestContext) {
 *   const user = await this.authService.validate(ctx.body)
 *   if (!user) return ctx.badRequest('Invalid credentials')
 *   await sessionLogin(ctx.session, user)
 *   ctx.json({ message: 'Logged in' })
 * }
 * ```
 */
export async function sessionLogin(
  session: { data: Record<string, any>; regenerate(): Promise<void>; save(): Promise<void> },
  user: AuthUser,
): Promise<void> {
  if (!session) {
    throw new Error('Session middleware not configured — add session() to your middleware array')
  }
  await session.regenerate()
  Object.assign(session.data, user)
  await session.save()
}

/**
 * Log a user out by destroying their session.
 *
 * @param session - The `ctx.session` object from RequestContext
 *
 * @example
 * ```ts
 * @Post('/logout')
 * @Authenticated()
 * async logout(ctx: RequestContext) {
 *   await sessionLogout(ctx.session)
 *   ctx.json({ message: 'Logged out' })
 * }
 * ```
 */
export async function sessionLogout(
  session: { destroy(): Promise<void> } | undefined,
): Promise<void> {
  if (!session) return
  await session.destroy()
}
