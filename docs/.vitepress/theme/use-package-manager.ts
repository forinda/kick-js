import { ref } from 'vue'

export const MANAGERS = ['pnpm', 'npm', 'yarn', 'bun'] as const
export type Manager = (typeof MANAGERS)[number]

const STORAGE_KEY = 'kickjs:pm'
const DEFAULT: Manager = 'pnpm'

function isManager(value: unknown): value is Manager {
  return MANAGERS.includes(value as Manager)
}

/**
 * One selection shared by every <PmCommand> on the page, and remembered
 * across visits. Module-level so switching one block switches them all —
 * a reader picking npm in the install snippet should not have to pick it
 * again six blocks later.
 */
export const pm = ref<Manager>(DEFAULT)

let hydrated = false

/**
 * Apply the stored choice. Called from onMounted, deliberately NOT at module
 * scope: mutating the ref during module evaluation happens before hydration,
 * and Vue then patches the rendered text but keeps the server-rendered class —
 * so the strip highlighted pnpm above a bunx command.
 */
export function hydratePm(): void {
  if (hydrated || typeof window === 'undefined') return
  hydrated = true

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (isManager(stored)) pm.value = stored
  } catch {
    // Site data blocked (private window, browser setting). The default holds.
  }

  // Keep other tabs of the docs in step.
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY && isManager(event.newValue)) pm.value = event.newValue
  })
}

export function setPm(next: Manager): void {
  pm.value = next
  try {
    window.localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Non-persistent selection is still a working selection.
  }
}
