/**
 * Pan / zoom maths for a canvas — screen = world * k + (x, y). Pure, so
 * it's unit-tested.
 */

export interface View {
  x: number
  y: number
  k: number
}

export const MIN_ZOOM = 0.2
export const MAX_ZOOM = 3

const clamp = (k: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k))

/** Zoom by `factor`, keeping the world point under screen point (px, py) still. */
export function zoomAt(view: View, factor: number, px: number, py: number): View {
  const k = clamp(view.k * factor)
  const ratio = k / view.k
  return { k, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio }
}

/** The view that fits `box` (world units) inside a `width`×`height` screen with `pad` around it. */
export function fitView(
  box: { x: number; y: number; w: number; h: number },
  width: number,
  height: number,
  pad = 24,
): View {
  const k = clamp(Math.min(1, (width - pad * 2) / box.w, (height - pad * 2) / box.h))
  return {
    k,
    x: (width - box.w * k) / 2 - box.x * k,
    y: (height - box.h * k) / 2 - box.y * k,
  }
}
