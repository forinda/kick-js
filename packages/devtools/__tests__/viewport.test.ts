import { describe, expect, it } from 'vitest'
import { fitView, zoomAt, MAX_ZOOM } from '../spa/src/lib/viewport'

const toScreen = (v: { x: number; y: number; k: number }, wx: number, wy: number) => [
  wx * v.k + v.x,
  wy * v.k + v.y,
]

describe('viewport', () => {
  it('zooms around the pointer — the point under it stays put', () => {
    const view = { x: 10, y: 20, k: 1 }
    const next = zoomAt(view, 2, 110, 70)
    // World point under (110, 70) before: (100, 50). Still under it after.
    expect(toScreen(next, 100, 50)).toEqual([110, 70])
    expect(next.k).toBe(2)
  })

  it('clamps zoom', () => {
    expect(zoomAt({ x: 0, y: 0, k: 2 }, 10, 0, 0).k).toBe(MAX_ZOOM)
  })

  it('fits and centres a box, never zooming past 100%', () => {
    const v = fitView({ x: 0, y: 0, w: 1000, h: 200 }, 548, 400, 24)
    expect(v.k).toBe(0.5)
    expect(toScreen(v, 500, 100)).toEqual([274, 200]) // box centre → screen centre
    expect(fitView({ x: 0, y: 0, w: 10, h: 10 }, 500, 500).k).toBe(1)
  })
})
