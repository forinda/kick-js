/**
 * One-time runtime deprecation notice. Lives in its own module (rather
 * than inline in index.ts) so it is unit-testable without importing the
 * adapters, which pull the optional `drizzle-orm` peer.
 */
export function warnDeprecated(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.KICKJS_SUPPRESS_DEPRECATION) return false
  console.warn(
    '[kickjs] @forinda/kickjs-drizzle is deprecated. It was an early-adoption adapter and ' +
      'is no longer maintained — @forinda/kickjs-db (schema DSL + client, dialect subpaths ' +
      '/pg /mysql /sqlite) is the supported DB layer going forward. ' +
      'This package will be removed in a future major. ' +
      'Set KICKJS_SUPPRESS_DEPRECATION=1 to silence this warning.',
  )
  return true
}
