/**
 * One-time runtime deprecation notice. Lives in its own module (rather
 * than inline in index.ts) so it is unit-testable without importing the
 * adapters, which pull the optional `@prisma/client` peer.
 */
export function warnDeprecated(env: NodeJS.ProcessEnv = process.env): boolean {
  // Match the documented contract (`=1`) plus the repo-wide env-flag
  // convention (run.ts resolvePolling) — a bare truthy check would make
  // `KICKJS_SUPPRESS_DEPRECATION=0` suppress too.
  const flag = env.KICKJS_SUPPRESS_DEPRECATION
  if (flag === '1' || flag === 'true') return false
  console.warn(
    '[kickjs] @forinda/kickjs-prisma is deprecated. It was an early-adoption adapter and ' +
      'is no longer maintained — wire Prisma directly in your app (BYO), or use ' +
      '@forinda/kickjs-db, the built-in Kick ORM, if you prefer to skip external ORMs. ' +
      'This package will be removed in a future major. ' +
      'Set KICKJS_SUPPRESS_DEPRECATION=1 to silence this warning.',
  )
  return true
}
