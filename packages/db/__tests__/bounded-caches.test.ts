/**
 * Long-lived state a client's requests could otherwise grow without limit.
 */
import { SelectQueryNode, TableNode, createQueryId, type QueryId } from 'kysely'
import { describe, expect, it } from 'vitest'
import { ResultExtensionPlugin } from '../src/extend/result-plugin'
import { defineTenancy } from '../src/tenancy'

describe('ResultExtensionPlugin', () => {
  it('holds a query only weakly: a query that fails before transformResult leaves nothing strong behind', async () => {
    const plugin = new ResultExtensionPlugin({
      users: { label: { needs: {}, compute: () => 'x' } },
    } as never)
    const queryId: QueryId = createQueryId()
    const node = SelectQueryNode.createFrom([TableNode.create('users')])
    plugin.transformQuery({ node, queryId })
    const pending = (plugin as unknown as { pending: unknown }).pending
    // Kysely skips transformResult when the database throws: a strong Map kept
    // one entry per failed query for the client's life.
    expect(pending).toBeInstanceOf(WeakMap)
    expect((pending as WeakMap<QueryId, string>).has(queryId)).toBe(true)
    // A query that does finish still clears its entry.
    await plugin.transformResult({ queryId, result: { rows: [] } })
    expect((pending as WeakMap<QueryId, string>).has(queryId)).toBe(false)
  })
})

describe("tenancy 'database'", () => {
  it('keeps at most 100 tenants open by default', () => {
    const tenancy = defineTenancy({ strategy: 'database', dialectFor: () => ({}) as never })
    expect(tenancy.maxOpenTenants).toBe(100)
    expect(
      defineTenancy({ strategy: 'database', dialectFor: () => ({}) as never, maxOpenTenants: 5 })
        .maxOpenTenants,
    ).toBe(5)
  })
})
