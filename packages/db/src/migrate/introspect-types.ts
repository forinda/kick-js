/**
 * Driver-agnostic SQL runner. Both pg.Client and pg.Pool match this shape via
 * structural typing. Lets introspectPg() stay portable across pg / pg-pool /
 * @neondatabase/serverless without importing 'pg' from the core package.
 */
export interface PgQueryRunner {
  query<R = unknown>(sql: string, params?: readonly unknown[]): Promise<{ rows: R[] }>
}

export interface IntrospectPgOptions {
  /** Default 'public'. */
  schema?: string
  /** Migration tracking tables to skip. Default ['kick_migrations', 'kick_migrations_lock']. */
  excludeTables?: readonly string[]
}
