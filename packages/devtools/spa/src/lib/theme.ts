// Theme management for the DevTools SPA.
//
// Three modes — `'dark'`, `'light'`, `'system'`. The user picks one;
// `'system'` follows `prefers-color-scheme` and re-resolves on OS-level
// changes. Persisted in localStorage so the choice survives reloads.
//
// The actual color swap is driven by `color-scheme` + the CSS variables
// in theme.css (which use `light-dark()` to pick the right value). This
// module only updates the document attributes; the rendering pipeline
// is pure CSS from there.

import { createSignal, createEffect, onCleanup } from 'solid-js'

export type ThemeMode = 'dark' | 'light' | 'system'
export type ResolvedTheme = 'dark' | 'light'

const STORAGE_KEY = 'kickjs-devtools-theme'

function readPersisted(): ThemeMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'dark' || raw === 'light' || raw === 'system') return raw
  } catch {
    // localStorage unavailable (incognito quota, sandboxed iframe) —
    // fall through to system default.
  }
  return 'system'
}

function systemPreference(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

const [mode, setModeSignal] = createSignal<ThemeMode>(readPersisted())
const [systemTheme, setSystemTheme] = createSignal<ResolvedTheme>(systemPreference())

if (typeof window !== 'undefined' && window.matchMedia) {
  const mq = window.matchMedia('(prefers-color-scheme: light)')
  const handler = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? 'light' : 'dark')
  mq.addEventListener('change', handler)
  // No unmount path — the SPA owns the document for its lifetime.
}

/** The mode the user picked (`'system'`, `'dark'`, `'light'`). */
export const themeMode = mode

/** Resolved value (`'dark'` | `'light'`) — what's actually applied. */
export function resolvedTheme(): ResolvedTheme {
  const m = mode()
  return m === 'system' ? systemTheme() : m
}

export function setTheme(next: ThemeMode): void {
  setModeSignal(next)
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Best-effort persistence; ignore quota / sandbox errors.
  }
}

/**
 * Mount the theme effect — applies `data-theme` to `<html>` whenever
 * the resolved value changes. Call once from the SPA root.
 */
export function mountThemeEffect(): void {
  createEffect(() => {
    const t = resolvedTheme()
    document.documentElement.dataset.theme = t
  })
  onCleanup(() => {
    delete document.documentElement.dataset.theme
  })
}
