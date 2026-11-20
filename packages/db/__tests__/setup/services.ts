/**
 * One Postgres and one MySQL for the whole db suite (Vitest globalSetup):
 * named, so a local re-run attaches to them instead of starting new ones;
 * fresh and removed afterwards in CI. Each test file makes its own database
 * on them (`./shared-server.ts`).
 */
import { kickTestServices } from '@forinda/kickjs-testing'

const start = kickTestServices({
  postgres: { name: 'kick-db-test-pg' },
  mysql: { name: 'kick-db-test-mysql' },
})

export default async function setup(project: Parameters<typeof start>[0]) {
  try {
    return await start(project)
  } catch (err) {
    // No Docker: the unit tests still run; container files fail, naming why.
    console.warn(`db suite: shared test services didn't start (${(err as Error).message})`)
    process.env.KICK_DB_SERVICES_ERROR = (err as Error).message
    return async () => {}
  }
}
