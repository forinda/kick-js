/**
 * Unit coverage for the MySQL adapter:
 *   - version-string parser (MySQL + MariaDB shapes)
 *   - version-assertion gate (8.0+ for MySQL, 10.5+ for MariaDB)
 *   - multi-statement SQL splitter
 *   - mock-pool query-call observation (caching, statement runs)
 *
 * Real-driver Testcontainers MySQL integration test ships in a
 * follow-up — kicking the larger Docker-image dependency to a
 * separate PR keeps this suite cheap to run on every commit.
 *
 * Spec: docs/db/spec-relational-query-other-dialects.md §7 R-1.
 */

import { describe, expect, it } from 'vitest'
import {
  mysqlAdapter,
  parseMysqlMajorVersion,
  parseMysqlVersion,
  splitMysqlStatements,
  type MysqlConnectionLike,
  type MysqlPoolLike,
} from '../../src'

describe('parseMysqlVersion', () => {
  it('parses standard MySQL 8.x.y shapes as flavor=mysql', () => {
    expect(parseMysqlVersion('8.0.34')).toEqual({ flavor: 'mysql', major: 8, minor: 0 })
    expect(parseMysqlVersion('8.4.0')).toEqual({ flavor: 'mysql', major: 8, minor: 4 })
    expect(parseMysqlVersion('8.0.34-log')).toEqual({ flavor: 'mysql', major: 8, minor: 0 })
  })

  it('parses MySQL 5.x as flavor=mysql', () => {
    expect(parseMysqlVersion('5.7.42')).toEqual({ flavor: 'mysql', major: 5, minor: 7 })
    expect(parseMysqlVersion('5.7.42-log')).toEqual({ flavor: 'mysql', major: 5, minor: 7 })
  })

  it('detects MariaDB and parses major + minor', () => {
    expect(parseMysqlVersion('10.6.11-MariaDB-1:10.6.11+maria~ubu2004')).toEqual({
      flavor: 'mariadb',
      major: 10,
      minor: 6,
    })
    expect(parseMysqlVersion('10.5.21-MariaDB-log')).toEqual({
      flavor: 'mariadb',
      major: 10,
      minor: 5,
    })
    expect(parseMysqlVersion('10.4.32-MariaDB')).toEqual({
      flavor: 'mariadb',
      major: 10,
      minor: 4,
    })
  })

  it('returns null on garbage input', () => {
    expect(parseMysqlVersion('')).toBeNull()
    expect(parseMysqlVersion('x.y.z')).toBeNull()
    expect(parseMysqlVersion('not-a-version')).toBeNull()
    expect(parseMysqlVersion('8')).toBeNull() // missing minor
  })

  it('handles leading whitespace', () => {
    expect(parseMysqlVersion('  8.0.34')).toEqual({ flavor: 'mysql', major: 8, minor: 0 })
  })
})

describe('parseMysqlMajorVersion (back-compat shim)', () => {
  it('still returns the major number for MySQL', () => {
    expect(parseMysqlMajorVersion('8.0.34')).toBe(8)
  })
  it('still returns 10 for MariaDB 10.x', () => {
    expect(parseMysqlMajorVersion('10.6.11-MariaDB')).toBe(10)
  })
  it('returns null on garbage', () => {
    expect(parseMysqlMajorVersion('xyz')).toBeNull()
  })
})

/**
 * Build a mock pool that records ALL queries (including
 * `SELECT VERSION()`) into a single observable array. Returns the
 * canned version string for any VERSION() probe.
 */
function makeMockPool(version: string): { pool: MysqlPoolLike; queries: string[] } {
  const queries: string[] = []
  const pool: MysqlPoolLike = {
    async query(sql: string) {
      queries.push(sql)
      if (/SELECT\s+VERSION\(\)/i.test(sql)) {
        return [[{ version }] as never, []]
      }
      return [{ affectedRows: 0 } as never, []]
    },
    async getConnection(): Promise<MysqlConnectionLike> {
      throw new Error('not used in version-check tests')
    },
  }
  return { pool, queries }
}

describe('mysqlAdapter — version assertion gate', () => {
  it('passes through on MySQL 8.0+', async () => {
    const { pool } = makeMockPool('8.0.34')
    const adapter = mysqlAdapter({ pool })
    await expect(adapter.ensureMigrationTables()).resolves.toBeUndefined()
  })

  it('passes through on MariaDB 10.5+', async () => {
    const { pool } = makeMockPool('10.6.11-MariaDB-log')
    const adapter = mysqlAdapter({ pool })
    await expect(adapter.ensureMigrationTables()).resolves.toBeUndefined()
  })

  it('throws on MySQL 5.7', async () => {
    const { pool } = makeMockPool('5.7.42-log')
    const adapter = mysqlAdapter({ pool })
    await expect(adapter.ensureMigrationTables()).rejects.toThrow(/MySQL 8\.0\+ required/)
  })

  it('throws on MariaDB 10.4 (below the 10.5 floor)', async () => {
    const { pool } = makeMockPool('10.4.32-MariaDB')
    const adapter = mysqlAdapter({ pool })
    await expect(adapter.ensureMigrationTables()).rejects.toThrow(/MariaDB 10\.5\+ required/)
  })

  it('throws on MariaDB 10.0', async () => {
    const { pool } = makeMockPool('10.0.38-MariaDB')
    const adapter = mysqlAdapter({ pool })
    await expect(adapter.ensureMigrationTables()).rejects.toThrow(/MariaDB 10\.5\+ required/)
  })

  it('passes on MariaDB 11.x (major above the floor)', async () => {
    const { pool } = makeMockPool('11.0.2-MariaDB')
    const adapter = mysqlAdapter({ pool })
    await expect(adapter.ensureMigrationTables()).resolves.toBeUndefined()
  })

  it('throws on unparseable version string', async () => {
    const { pool } = makeMockPool('not-a-version')
    const adapter = mysqlAdapter({ pool })
    await expect(adapter.ensureMigrationTables()).rejects.toThrow(/unparseable version/)
  })

  it('caches the version check after first success — VERSION() runs exactly once', async () => {
    const { pool, queries } = makeMockPool('8.0.34')
    const adapter = mysqlAdapter({ pool })
    await adapter.ensureMigrationTables()
    await adapter.ensureMigrationTables()
    const versionQueries = queries.filter((q) => /SELECT\s+VERSION\(\)/i.test(q))
    expect(versionQueries.length).toBe(1)
  })
})

describe('splitMysqlStatements', () => {
  it('splits a simple two-statement DDL block', () => {
    const sql = `CREATE TABLE foo (id int);\nINSERT INTO foo VALUES (1);`
    expect(splitMysqlStatements(sql)).toEqual([
      'CREATE TABLE foo (id int)',
      'INSERT INTO foo VALUES (1)',
    ])
  })

  it('returns a single statement when no semicolon present', () => {
    expect(splitMysqlStatements('SELECT 1')).toEqual(['SELECT 1'])
  })

  it('treats trailing semicolon as terminator, not empty statement', () => {
    expect(splitMysqlStatements('SELECT 1;')).toEqual(['SELECT 1'])
  })

  it('ignores semicolons inside single-quote string literals', () => {
    const sql = `INSERT INTO t VALUES ('a;b'); INSERT INTO t VALUES ('c');`
    expect(splitMysqlStatements(sql)).toEqual([
      `INSERT INTO t VALUES ('a;b')`,
      `INSERT INTO t VALUES ('c')`,
    ])
  })

  it('ignores semicolons inside double-quote string literals', () => {
    const sql = `INSERT INTO t VALUES ("a;b"); INSERT INTO t VALUES ("c");`
    expect(splitMysqlStatements(sql)).toEqual([
      `INSERT INTO t VALUES ("a;b")`,
      `INSERT INTO t VALUES ("c")`,
    ])
  })

  it('ignores semicolons inside backtick identifiers', () => {
    const sql = 'SELECT `weird;name` FROM t; SELECT 1;'
    expect(splitMysqlStatements(sql)).toEqual(['SELECT `weird;name` FROM t', 'SELECT 1'])
  })

  it('ignores semicolons inside `--` line comments', () => {
    const sql = `SELECT 1 -- not; a separator\n; SELECT 2;`
    const out = splitMysqlStatements(sql)
    expect(out).toHaveLength(2)
    expect(out[0]).toContain('SELECT 1')
    expect(out[1]).toBe('SELECT 2')
  })

  it('ignores semicolons inside `/* */` block comments', () => {
    const sql = `SELECT 1 /* not; a; separator */; SELECT 2;`
    expect(splitMysqlStatements(sql)).toEqual(['SELECT 1 /* not; a; separator */', 'SELECT 2'])
  })

  it('handles escaped quotes inside string literals', () => {
    const sql = `INSERT INTO t VALUES ('it\\'s; fine'); SELECT 1;`
    const out = splitMysqlStatements(sql)
    expect(out).toHaveLength(2)
    expect(out[0]).toContain("it\\'s; fine")
    expect(out[1]).toBe('SELECT 1')
  })
})

describe('mysqlAdapter — multi-statement DDL via splitter', () => {
  it('ensureMigrationTables splits the multi-statement DDL into separate query() calls', async () => {
    const { pool, queries } = makeMockPool('8.0.34')
    const adapter = mysqlAdapter({ pool })
    await adapter.ensureMigrationTables()

    const ddlQueries = queries.filter((q) => !/SELECT\s+VERSION\(\)/i.test(q))

    // No DDL statement should still contain a top-level `;` —
    // default mysql2 settings reject multi-statement queries, so
    // every entry in ddlQueries must be a single statement.
    for (const q of ddlQueries) {
      expect(q.endsWith(';')).toBe(false)
    }
    // migrationsTableDdl + lockTableDdl together emit > 1
    // top-level statements; the splitter must pull them apart.
    expect(ddlQueries.length).toBeGreaterThan(2)
  })

  it('applySqlNoTx splits a multi-statement migration', async () => {
    const { pool, queries } = makeMockPool('8.0.34')
    const adapter = mysqlAdapter({ pool })
    await adapter.ensureMigrationTables()
    queries.length = 0

    await adapter.applySqlNoTx(`CREATE TABLE x (id int);\nINSERT INTO x VALUES (1);`)
    expect(queries).toEqual(['CREATE TABLE x (id int)', 'INSERT INTO x VALUES (1)'])
  })

  it('introspect throws — drift detection lands in a follow-up', async () => {
    const { pool } = makeMockPool('8.0.34')
    const adapter = mysqlAdapter({ pool })
    await expect(adapter.introspect()).rejects.toThrow(/not supported in v1/)
  })
})
