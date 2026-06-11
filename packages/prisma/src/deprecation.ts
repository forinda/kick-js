/**
 * One-time runtime deprecation notice. Lives in its own module (rather
 * than inline in index.ts) so it is unit-testable without importing the
 * adapters, which pull the optional `@prisma/client` peer.
 */
export function warnDeprecated(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.KICKJS_SUPPRESS_DEPRECATION) return false
  console.warn(
    '[kickjs] @forinda/kickjs-prisma is deprecated — the DB layer is consolidated ' +
      'into @forinda/kickjs-db (schema DSL + client, dialect subpaths /pg /mysql /sqlite). ' +
      'This package will be removed in a future major. ' +
      'Set KICKJS_SUPPRESS_DEPRECATION=1 to silence this warning.',
  )
  return true
}
