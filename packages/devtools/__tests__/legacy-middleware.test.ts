/**
 * On a `@forinda/kickjs` release without the response funnel (still a
 * supported peer), the adapter keeps counting through its own middleware.
 * The module mock drops `reportResponse`, which is what the adapter checks.
 */
import 'reflect-metadata'
import { describe, it, expect, vi } from 'vitest'

vi.mock('@forinda/kickjs', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  // A real older release has no such export (the namespace read is
  // `undefined`); vitest's mock throws on missing exports, so model it as
  // an explicit `undefined`.
  return { ...actual, reportResponse: undefined }
})

const { DevToolsAdapter } = await import('@forinda/kickjs-devtools')

function finish(adapter: ReturnType<typeof DevToolsAdapter>, status: number, path?: string) {
  const handler = adapter.middleware()[0]!.handler as (
    req: unknown,
    res: unknown,
    next: () => void,
  ) => void
  let onFinish: () => void = () => {}
  const req = {
    method: 'GET',
    [Symbol.for('kick.route')]: path
      ? { path: '/:id', pattern: path, flags: new Map() }
      : undefined,
  }
  const res = { statusCode: status, on: (_e: string, cb: () => void) => (onFinish = cb) }
  const next = vi.fn()
  handler(req, res, next)
  onFinish()
  return next
}

describe('DevToolsAdapter on a kickjs without reportResponse', () => {
  it('installs its own middleware and counts through it', () => {
    const adapter = DevToolsAdapter({ enabled: true })
    expect(adapter.middleware()).toHaveLength(1)

    expect(finish(adapter, 200, '/api/v1/users/:id')).toHaveBeenCalledOnce()
    finish(adapter, 500, '/api/v1/users/:id')
    finish(adapter, 404)

    expect(adapter.requestCount.value).toBe(3)
    expect(adapter.errorCount.value).toBe(1)
    expect(adapter.clientErrorCount.value).toBe(1)
    expect(adapter.routeLatency['GET /api/v1/users/:id'].count).toBe(2)
    expect(adapter.routeLatency['GET <unmatched>'].count).toBe(1)
  })
})
