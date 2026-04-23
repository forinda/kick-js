import { createSignal, Show, type Component } from 'solid-js'
import { RuntimeTab } from './tabs/RuntimeTab'
import { MemoryTab } from './tabs/MemoryTab'
import { TopologyTab } from './tabs/TopologyTab'
import { RoutesTab } from './tabs/RoutesTab'

type TabId = 'runtime' | 'memory' | 'topology' | 'routes'

interface TabSpec {
  id: TabId
  label: string
}

const TABS: readonly TabSpec[] = [
  { id: 'runtime', label: 'Runtime' },
  { id: 'memory', label: 'Memory' },
  { id: 'topology', label: 'Topology' },
  { id: 'routes', label: 'Routes' },
]

export const App: Component = () => {
  // Persist last tab to localStorage so a refresh preserves the user's
  // place. Ignore parse failures — defaulting to Runtime is harmless.
  const initial = (() => {
    try {
      const saved = localStorage.getItem('kickjs-devtools-tab')
      if (saved && TABS.some((t) => t.id === saved)) return saved as TabId
    } catch {
      // localStorage may throw in private mode — ignore
    }
    return 'runtime'
  })()

  const [active, setActive] = createSignal<TabId>(initial)

  const switchTo = (id: TabId): void => {
    setActive(id)
    try {
      localStorage.setItem('kickjs-devtools-tab', id)
    } catch {
      // ignore
    }
  }

  return (
    <div class="app">
      <nav class="tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            type="button"
            role="tab"
            class={`tab ${active() === tab.id ? 'active' : ''}`}
            aria-selected={active() === tab.id}
            onClick={() => switchTo(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <main class="tab-body">
        <Show when={active() === 'runtime'}>
          <RuntimeTab />
        </Show>
        <Show when={active() === 'memory'}>
          <MemoryTab />
        </Show>
        <Show when={active() === 'topology'}>
          <TopologyTab />
        </Show>
        <Show when={active() === 'routes'}>
          <RoutesTab />
        </Show>
      </main>
    </div>
  )
}
