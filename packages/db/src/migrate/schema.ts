import type { Dialect } from '../snapshot/types'

export const KICK_MIGRATIONS_TABLE = 'kick_migrations'
export const KICK_LOCK_TABLE = 'kick_migrations_lock'
/** Where `kick db push` keeps the schema it last pushed. */
export const KICK_PUSH_TABLE = 'kick_push'

/** The lock table that goes with a migrations table. */
export function lockTableName(table: string): string {
  return `${table}_lock`
}

/**
 * A table name quoted for the dialect. A dotted name is schema-qualified on
 * Postgres (`meta.kick_migrations`); elsewhere a dot is part of the name.
 */
export function quoteTable(dialect: Dialect, name: string): string {
  if (dialect === 'mysql') return `\`${name.replaceAll('`', '``')}\``
  const parts = dialect === 'postgres' ? name.split('.') : [name]
  return parts.map((p) => `"${p.replaceAll('"', '""')}"`).join('.')
}

/** The bare table name, for names derived from it (an index can't be schema-qualified). */
function bareName(name: string): string {
  return name.slice(name.lastIndexOf('.') + 1)
}

export function migrationsTableDdl(
  dialect: Dialect,
  table: string = KICK_MIGRATIONS_TABLE,
): string {
  const T = quoteTable(dialect, table)
  const idx = quoteTable(dialect, `${bareName(table)}_batch_idx`)
  switch (dialect) {
    case 'postgres':
      // A schema-qualified table needs its schema; created if missing.
      return `${table.includes('.') ? `CREATE SCHEMA IF NOT EXISTS ${quoteTable(dialect, table.slice(0, table.lastIndexOf('.')))};\n      ` : ''}CREATE TABLE IF NOT EXISTS ${T} (
        "id" varchar(128) PRIMARY KEY,
        "name" text NOT NULL,
        "hash" text NOT NULL,
        "batch" integer NOT NULL,
        "applied_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "direction" varchar(8) NOT NULL DEFAULT 'up'
      );
      CREATE INDEX IF NOT EXISTS ${idx} ON ${T} ("batch");`
    case 'sqlite':
      return `CREATE TABLE IF NOT EXISTS ${T} (
        "id" text PRIMARY KEY,
        "name" text NOT NULL,
        "hash" text NOT NULL,
        "batch" integer NOT NULL,
        "applied_at" text NOT NULL DEFAULT (datetime('now')),
        "direction" text NOT NULL DEFAULT 'up'
      );
      CREATE INDEX IF NOT EXISTS ${idx} ON ${T} ("batch");`
    case 'mysql':
      return `CREATE TABLE IF NOT EXISTS ${T} (
        \`id\` varchar(128) PRIMARY KEY,
        \`name\` text NOT NULL,
        \`hash\` text NOT NULL,
        \`batch\` int NOT NULL,
        \`applied_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`direction\` varchar(8) NOT NULL DEFAULT 'up',
        INDEX ${idx} (\`batch\`)
      );`
  }
}

export function lockTableDdl(dialect: Dialect, table: string = KICK_MIGRATIONS_TABLE): string {
  const L = quoteTable(dialect, lockTableName(table))
  switch (dialect) {
    case 'postgres':
      return `CREATE TABLE IF NOT EXISTS ${L} (
        "id" smallint PRIMARY KEY,
        "locked_at" timestamptz,
        "locked_by" text
      );
      INSERT INTO ${L} ("id") VALUES (1) ON CONFLICT DO NOTHING;`
    case 'sqlite':
      return `CREATE TABLE IF NOT EXISTS ${L} (
        "id" integer PRIMARY KEY,
        "locked_at" text,
        "locked_by" text
      );
      INSERT OR IGNORE INTO ${L} ("id") VALUES (1);`
    case 'mysql':
      return `CREATE TABLE IF NOT EXISTS ${L} (
        \`id\` smallint PRIMARY KEY,
        \`locked_at\` timestamp NULL,
        \`locked_by\` text
      );
      INSERT IGNORE INTO ${L} (\`id\`) VALUES (1);`
  }
}
