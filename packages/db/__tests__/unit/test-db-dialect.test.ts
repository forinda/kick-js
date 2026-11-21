/** Which database useTestDb makes when it isn't told. */
import { describe, expect, it } from 'vitest'
import { testDbDialect } from '../../src/test-db-dialect'

describe('testDbDialect', () => {
  it('takes the dialect given, else the server known', () => {
    expect(testDbDialect({ dialect: 'mysql' }, { pg: 'postgres://x' })).toBe('mysql')
    expect(testDbDialect({ connectionString: 'postgres://x' }, {})).toBe('postgres')
    expect(testDbDialect({}, { pg: 'postgres://x', mysql: 'mysql://x' })).toBe('postgres')
    expect(testDbDialect({}, { mysql: 'mysql://x' })).toBe('mysql')
    expect(testDbDialect({}, {})).toBe('sqlite')
  })

  it("refuses to run server migrations on SQLite when there's no server", () => {
    expect(() => testDbDialect({ migrationsDir: 'db/migrations' }, {})).toThrow(
      /no Postgres or MySQL server.*dialect: 'sqlite'/s,
    )
    expect(testDbDialect({ migrationsDir: 'm', dialect: 'sqlite' }, {})).toBe('sqlite')
  })
})
