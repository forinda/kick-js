import { describe, expect, it } from 'vitest'
import { safeEqual } from '../src/core/web-crypto'

describe('safeEqual', () => {
  it('matches equal strings and rejects any difference', () => {
    expect(safeEqual('abc123', 'abc123')).toBe(true)
    expect(safeEqual('abc123', 'abc124')).toBe(false)
    expect(safeEqual('abc', 'abc1')).toBe(false)
    expect(safeEqual('', 'a')).toBe(false)
  })
})
