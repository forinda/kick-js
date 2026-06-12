/**
 * One-time runtime deprecation notice. Lives in its own module (rather
 * than inline in index.ts) so it is unit-testable without importing the
 * strategies, which pull optional peers (jsonwebtoken, argon2, bcrypt).
 */
export function warnDeprecated(env: NodeJS.ProcessEnv = process.env): boolean {
  // Match the documented contract (`=1`) plus the repo-wide env-flag
  // convention (run.ts resolvePolling) — a bare truthy check would make
  // `KICKJS_SUPPRESS_DEPRECATION=0` suppress too.
  const flag = env.KICKJS_SUPPRESS_DEPRECATION
  if (flag === '1' || flag === 'true') return false
  console.warn(
    '[kickjs] @forinda/kickjs-auth is deprecated — auth is moving to BYO (bring-your-own): ' +
      'compose @LoadAuthUser / @RequireRole / @Public from defineContextDecorator and ' +
      'defineAdapter (see the BYO Auth recipe in the KickJS docs). ' +
      'This package will be removed in a future major. ' +
      'Set KICKJS_SUPPRESS_DEPRECATION=1 to silence this warning.',
  )
  return true
}
