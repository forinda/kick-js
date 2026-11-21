/** The database useTestDb makes: the one asked for, else the server it knows of, else SQLite. */
export function testDbDialect(
  opts: {
    dialect?: 'postgres' | 'mysql' | 'sqlite'
    connectionString?: string
    migrationsDir?: string
  },
  servers: { pg?: string; mysql?: string },
): 'postgres' | 'mysql' | 'sqlite' {
  if (opts.dialect) return opts.dialect
  if (opts.connectionString || servers.pg) return 'postgres'
  if (servers.mysql) return 'mysql'
  // Migrations are written for one dialect: Postgres SQL run on SQLite fails
  // somewhere in the middle, so say what's missing instead.
  if (opts.migrationsDir)
    throw new Error(
      `useTestDb: migrations in ${opts.migrationsDir} but no Postgres or MySQL server is known ` +
        `(is kickTestServices in globalSetup?). For SQLite migrations, pass dialect: 'sqlite'.`,
    )
  return 'sqlite'
}
