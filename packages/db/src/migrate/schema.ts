import type { Dialect } from '../snapshot/types'

export const KICK_MIGRATIONS_TABLE = 'kick_migrations'
export const KICK_LOCK_TABLE = 'kick_migrations_lock'

export function migrationsTableDdl(dialect: Dialect): string {
  switch (dialect) {
    case 'postgres':
      return `CREATE TABLE IF NOT EXISTS "${KICK_MIGRATIONS_TABLE}" (
        "id" varchar(128) PRIMARY KEY,
        "name" text NOT NULL,
        "hash" text NOT NULL,
        "batch" integer NOT NULL,
        "applied_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "direction" varchar(8) NOT NULL DEFAULT 'up'
      );
      CREATE INDEX IF NOT EXISTS "${KICK_MIGRATIONS_TABLE}_batch_idx" ON "${KICK_MIGRATIONS_TABLE}" ("batch");`
    case 'sqlite':
      return `CREATE TABLE IF NOT EXISTS "${KICK_MIGRATIONS_TABLE}" (
        "id" text PRIMARY KEY,
        "name" text NOT NULL,
        "hash" text NOT NULL,
        "batch" integer NOT NULL,
        "applied_at" text NOT NULL DEFAULT (datetime('now')),
        "direction" text NOT NULL DEFAULT 'up'
      );
      CREATE INDEX IF NOT EXISTS "${KICK_MIGRATIONS_TABLE}_batch_idx" ON "${KICK_MIGRATIONS_TABLE}" ("batch");`
    case 'mysql':
      return `CREATE TABLE IF NOT EXISTS \`${KICK_MIGRATIONS_TABLE}\` (
        \`id\` varchar(128) PRIMARY KEY,
        \`name\` text NOT NULL,
        \`hash\` text NOT NULL,
        \`batch\` int NOT NULL,
        \`applied_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`direction\` varchar(8) NOT NULL DEFAULT 'up',
        INDEX \`${KICK_MIGRATIONS_TABLE}_batch_idx\` (\`batch\`)
      );`
  }
}

export function lockTableDdl(dialect: Dialect): string {
  switch (dialect) {
    case 'postgres':
      return `CREATE TABLE IF NOT EXISTS "${KICK_LOCK_TABLE}" (
        "id" smallint PRIMARY KEY,
        "locked_at" timestamptz,
        "locked_by" text
      );
      INSERT INTO "${KICK_LOCK_TABLE}" ("id") VALUES (1) ON CONFLICT DO NOTHING;`
    case 'sqlite':
      return `CREATE TABLE IF NOT EXISTS "${KICK_LOCK_TABLE}" (
        "id" integer PRIMARY KEY,
        "locked_at" text,
        "locked_by" text
      );
      INSERT OR IGNORE INTO "${KICK_LOCK_TABLE}" ("id") VALUES (1);`
    case 'mysql':
      return `CREATE TABLE IF NOT EXISTS \`${KICK_LOCK_TABLE}\` (
        \`id\` smallint PRIMARY KEY,
        \`locked_at\` timestamp NULL,
        \`locked_by\` text
      );
      INSERT IGNORE INTO \`${KICK_LOCK_TABLE}\` (\`id\`) VALUES (1);`
  }
}
