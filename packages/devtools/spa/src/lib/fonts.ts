// Font overrides for the DevTools SPA. The viewer names fonts they have
// installed; those go first, and the dashboard's own stacks stay behind
// them as fallbacks — a font that isn't installed just falls through.
//
// Applied by setting `--font-sans` / `--font-mono` on <html>, which every
// `font-sans` / `font-mono` utility and `var(--font-mono)` reads. Persisted
// in localStorage like theme and density.

import { createSignal, createEffect, onCleanup } from 'solid-js'

export type FontSlot = 'sans' | 'mono'

const STORAGE_KEY = 'kickjs-devtools-fonts'

function readPersisted(): Record<FontSlot, string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
    return {
      sans: typeof o.sans === 'string' ? o.sans : '',
      mono: typeof o.mono === 'string' ? o.mono : '',
    }
  } catch {
    return { sans: '', mono: '' }
  }
}

const [fonts, setFontsSignal] = createSignal(readPersisted())

/** The viewer's font names per slot, as typed ('' = the default). */
export const fontOverrides = fonts

export function setFont(slot: FontSlot, value: string): void {
  const next = { ...fonts(), [slot]: value }
  setFontsSignal(next)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Best-effort persistence.
  }
}

/**
 * The viewer's comma-separated font names, each quoted, ahead of `fallback`.
 * Quotes and anything that could end the declaration are stripped from the
 * names, so a typo can't invalidate the whole stack. `undefined` when there
 * is nothing to add.
 */
export function fontStack(names: string, fallback: string): string | undefined {
  const quoted = names
    .split(',')
    .map((n) => n.replace(/["';{}\\]/g, '').trim())
    .filter(Boolean)
    .map((n) => `"${n}"`)
  return quoted.length ? `${quoted.join(', ')}, ${fallback}` : undefined
}

/** Apply the overrides to <html> whenever they change. Call once from the SPA root. */
export function mountFontEffect(): void {
  const root = document.documentElement
  // The dashboard's own stacks, read before any override is set.
  const defaults: Record<FontSlot, string> = {
    sans: getComputedStyle(root).getPropertyValue('--font-sans').trim() || 'sans-serif',
    mono: getComputedStyle(root).getPropertyValue('--font-mono').trim() || 'monospace',
  }
  createEffect(() => {
    for (const slot of ['sans', 'mono'] as const) {
      const stack = fontStack(fonts()[slot], defaults[slot])
      if (stack) root.style.setProperty(`--font-${slot}`, stack)
      else root.style.removeProperty(`--font-${slot}`)
    }
  })
  onCleanup(() => {
    root.style.removeProperty('--font-sans')
    root.style.removeProperty('--font-mono')
  })
}
