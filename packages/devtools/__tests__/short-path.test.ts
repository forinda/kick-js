import { describe, it, expect } from 'vitest'
import { shortPath } from '../spa/src/lib/format'

describe('shortPath', () => {
  it('cuts long id segments and keeps words and short ids', () => {
    expect(shortPath('/api/v1/work/items/01J9ZKQ4X8M2N7P5R3/comments')).toBe(
      '/api/v1/work/items/01J9ZK…/comments',
    )
    expect(shortPath('/api/v1/goal-cycles/2026-Q4')).toBe('/api/v1/goal-cycles/2026-Q4')
    expect(shortPath('/api/v1/password-reset/request')).toBe('/api/v1/password-reset/request')
    expect(shortPath('/files/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b?x=1')).toBe('/files/0f1e2d…?x=1')
  })
})
