// Density management for the DevTools SPA.
//
// Three levels — `'sm'` (default), `'md'`, `'lg'` — control the overall
// spacing + type scale so the dashboard can run tight (sm, to maximise
// data on screen) or roomy (lg). The lever is the root font-size: every
// Tailwind spacing/text utility is rem-based, so scaling the root scales
// padding, gaps, row height, and font sizes together in one step.
//
// Persisted in localStorage so the choice survives reloads. Defaults to
// `'sm'` to limit space utilisation, per the dashboard's data-dense goal.

import { createSignal, createEffect, onCleanup } from 'solid-js'

export type DensityMode = 'sm' | 'md' | 'lg'

const STORAGE_KEY = 'kickjs-devtools-density'
const ORDER: readonly DensityMode[] = ['sm', 'md', 'lg']

function readPersisted(): DensityMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'sm' || raw === 'md' || raw === 'lg') return raw
  } catch {
    // localStorage unavailable (incognito quota, sandboxed iframe).
  }
  return 'sm'
}

const [mode, setModeSignal] = createSignal<DensityMode>(readPersisted())

/** The active density level. */
export const densityMode = mode

export function setDensity(next: DensityMode): void {
  setModeSignal(next)
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Best-effort persistence.
  }
}

/** Cycle sm → md → lg → sm. Wired to the header density toggle. */
export function cycleDensity(): void {
  const i = ORDER.indexOf(mode())
  setDensity(ORDER[(i + 1) % ORDER.length])
}

/**
 * Mount the density effect — applies `data-density` to `<html>` whenever
 * the level changes. The `[data-density]` rules in theme.css set the root
 * font-size. Call once from the SPA root.
 */
export function mountDensityEffect(): void {
  createEffect(() => {
    document.documentElement.dataset.density = mode()
  })
  onCleanup(() => {
    delete document.documentElement.dataset.density
  })
}
