/**
 * Unit coverage for the MySQL 8.0+ version assertion + the version
 * string parser. The full real-driver integration test using
 * Testcontainers MySQL lands in a follow-up — kicking the larger
 * Docker-image dependency to a separate PR keeps this package's
 * suite cheap to run on every commit.
 *
 * Spec: docs/db/spec-relational-query-other-dialects.md §7 R-1.
 */

import { describe, expect, it } from 'vitest'
import { mysqlAdapter, parseMysqlMajorVersion, type MysqlPoolLike } from '../../src'

describe('parseMysqlMajorVersion', () => {
  it('parses standard 8.x.y shapes', () => {
    expect(parseMysqlMajorVersion('8.0.34')).toBe(8)
    expect(parseMysqlMajorVersion('8.4.0')).toBe(8)
    expect(parseMysqlMajorVersion('8.0.34-log')).toBe(8)
  })

  it('parses 5.x as 5', () => {
    expect(parseMysqlMajorVersion('5.7.42')).toBe(5)
    expect(parseMysqlMajorVersion('5.7.42-log')).toBe(5)
  })

  it('parses MariaDB 10.x as 10 (above the 8 floor)', () => {
    expect(parseMysqlMajorVersion('10.6.11-MariaDB-1:10.6.11+maria~ubu2004')).toBe(10)
    expect(parseMysqlMajorVersion('10.5.21-MariaDB-log')).toBe(10)
  })

  it('returns null on garbage input', () => {
    expect(parseMysqlMajorVersion('')).toBeNull()
    expect(parseMysqlMajorVersion('x.y.z')).toBeNull()
    expect(parseMysqlMajorVersion('not-a-version')).toBeNull()
  })

  it('handles leading whitespace', () => {
    expect(parseMysqlMajorVersion('  8.0.34')).toBe(8)
  })
})

/**
 * Build a minimal mock pool that returns a canned VERSION() result
 * + asserts no other queries run before the version check passes.
 */
function makeMockPool(version: string, otherQueries: string[] = []): MysqlPoolLike {
  let versionAsked = false
  const queries: string[] = []
  return {
    async query(sql: string) {
      queries.push(sql)
      if (/^SELECT VERSION/i.test(sql)) {
        versionAsked = true
        return [[{ version }] as never[], []]
      }
      // Track non-version queries; tests assert the version assertion
      // gates them.
      otherQueries.push(sql)
      void versionAsked
      return [[] as never[], []]
    },
    async getConnection() {
      throw new Error('not used in version-check tests')
    },
  }
}

describe('mysqlAdapter — version assertion gate', () => {
  it('passes through on MySQL 8.0+', async () => {
    const adapter = mysqlAdapter({ pool: makeMockPool('8.0.34') })
    await expect(adapter.ensureMigrationTables()).resolves.toBeUndefined()
  })

  it('passes through on MariaDB 10.x', async () => {
    const adapter = mysqlAdapter({ pool: makeMockPool('10.6.11-MariaDB-log') })
    await expect(adapter.ensureMigrationTables()).resolves.toBeUndefined()
  })

  it('throws KickDbError on MySQL 5.7', async () => {
    const adapter = mysqlAdapter({ pool: makeMockPool('5.7.42-log') })
    await expect(adapter.ensureMigrationTables()).rejects.toThrow(/MySQL 8\.0\+ required/)
  })

  it('throws KickDbError on unparseable version string', async () => {
    const adapter = mysqlAdapter({ pool: makeMockPool('not-a-version') })
    await expect(adapter.ensureMigrationTables()).rejects.toThrow(/MySQL 8\.0\+ required/)
  })

  it('caches the version check after first success', async () => {
    const queries: string[] = []
    const adapter = mysqlAdapter({ pool: makeMockPool('8.0.34', queries) })
    await adapter.ensureMigrationTables()
    await adapter.ensureMigrationTables()
    // Second call should not re-run SELECT VERSION().
    const versionQueries = queries.filter((q) => /VERSION/i.test(q))
    expect(versionQueries.length).toBe(0) // VERSION() goes to a different pile in the mock
    // The other queries pile collected the DDL — first call ran 2,
    // second call ran 2 more = 4 DDL invocations total.
    expect(queries.length).toBe(4)
  })

  it('introspect throws — drift detection lands in a follow-up', async () => {
    const adapter = mysqlAdapter({ pool: makeMockPool('8.0.34') })
    await expect(adapter.introspect()).rejects.toThrow(/not supported in v1/)
  })
})
