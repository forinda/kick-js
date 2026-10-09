/**
 * The active dashboard tab, shared so anything — the sidebar, the command
 * palette, "Try" on a request — can switch tabs. Persisted per browser.
 */
import { createSignal } from 'solid-js'

const KEY = 'kickjs-devtools-tab'

/** Tabs that were merged into another — a remembered old id opens the new one. */
export const MERGED_TABS: Record<string, string> = {
  memory: 'runtime',
  topology: 'runtime',
  graph: 'container',
}

function initialTab(): string {
  try {
    const saved = localStorage.getItem(KEY) ?? 'overview'
    return MERGED_TABS[saved] ?? saved
  } catch {
    return 'overview'
  }
}

const [activeTab, setActiveTab] = createSignal<string>(initialTab())
export { activeTab }

export function switchTab(tab: string): void {
  const id = MERGED_TABS[tab] ?? tab
  setActiveTab(id)
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // storage unavailable — the tab still switches
  }
}
