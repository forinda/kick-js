/**
 * The active dashboard tab, shared so anything — the sidebar, the command
 * palette, "Try" on a request — can switch tabs. Persisted per browser.
 */
import { createSignal } from 'solid-js'

const KEY = 'kickjs-devtools-tab'

function initialTab(): string {
  try {
    return localStorage.getItem(KEY) ?? 'overview'
  } catch {
    return 'overview'
  }
}

const [activeTab, setActiveTab] = createSignal<string>(initialTab())
export { activeTab }

export function switchTab(id: string): void {
  setActiveTab(id)
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // storage unavailable — the tab still switches
  }
}
