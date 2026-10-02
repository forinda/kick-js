import { describe, expect, it } from 'vitest'
import { mysqlAdapter } from '@forinda/kickjs-db/mysql'
import { pgAdapter } from '@forinda/kickjs-db/pg'

describe('endPoolOnClose', () => {
  const noEnd = { query: async () => [[], null] as never, getConnection: async () => ({}) as never }

  it('refuses a pool it cannot close', () => {
    expect(() => mysqlAdapter({ pool: noEnd, endPoolOnClose: true })).toThrow(/end\(\)/)
    expect(() =>
      pgAdapter({
        pool: { query: noEnd.query, connect: async () => ({}) as never },
        endPoolOnClose: true,
      }),
    ).toThrow(/end\(\)/)
  })

  it('ends the pool on close', async () => {
    let ended = 0
    const pool = { ...noEnd, end: async () => void ended++ }
    await mysqlAdapter({ pool, endPoolOnClose: true }).close()
    await mysqlAdapter({ pool }).close()
    expect(ended).toBe(1)
  })
})
