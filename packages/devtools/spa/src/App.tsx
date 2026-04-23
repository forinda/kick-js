import { createSignal, For, onMount, Show, type Component } from 'solid-js'
import type { DevtoolsTabDescriptor } from '@forinda/kickjs-devtools-kit'
import { RuntimeTab } from './tabs/RuntimeTab'
import { MemoryTab } from './tabs/MemoryTab'
import { TopologyTab } from './tabs/TopologyTab'
import { RoutesTab } from './tabs/RoutesTab'
import { CustomTab } from './tabs/CustomTab'
import { rpc } from './lib/rpc'

type BuiltInTabId = 'runtime' | 'memory' | 'topology' | 'routes'

interface BuiltInTabSpec {
  id: BuiltInTabId
  label: string
}

const BUILT_INS: readonly BuiltInTabSpec[] = [
  { id: 'runtime', label: 'Runtime' },
  { id: 'memory', label: 'Memory' },
  { id: 'topology', label: 'Topology' },
  { id: 'routes', label: 'Routes' },
]

/** Reserved built-in IDs so a custom tab can't shadow them. */
const RESERVED: ReadonlySet<string> = new Set(BUILT_INS.map((t) => t.id))

export const App: Component = () => {
  const initial = (() => {
    try {
      const saved = localStorage.getItem('kickjs-devtools-tab')
      if (saved) return saved
    } catch {
      // localStorage may throw in private mode — ignore
    }
    return 'runtime'
  })()

  const [active, setActive] = createSignal<string>(initial)
  const [customTabs, setCustomTabs] = createSignal<DevtoolsTabDescriptor[]>([])
  const [tabErrors, setTabErrors] = createSignal<ReadonlyArray<{ source: string; reason: string }>>(
    [],
  )

  onMount(() => {
    void rpc
      .tabs()
      .then(({ tabs, errors }) => {
        // Defensive: drop any tab whose id collides with a built-in
        // even though the server-side aggregator should never emit one.
        setCustomTabs(tabs.filter((t) => !RESERVED.has(t.id)))
        setTabErrors(errors)
      })
      .catch(() => {
        // Tabs endpoint may 503 during startup — silent fall back to
        // built-ins-only. The Topology tab will surface the same
        // error if the issue is persistent.
      })
  })

  const switchTo = (id: string): void => {
    setActive(id)
    try {
      localStorage.setItem('kickjs-devtools-tab', id)
    } catch {
      // ignore
    }
  }

  const activeCustom = (): DevtoolsTabDescriptor | undefined =>
    customTabs().find((t) => t.id === active())

  return (
    <div class="app">
      <nav class="tabs" role="tablist">
        <For each={BUILT_INS}>
          {(tab) => (
            <button
              type="button"
              role="tab"
              class={`tab ${active() === tab.id ? 'active' : ''}`}
              aria-selected={active() === tab.id}
              onClick={() => switchTo(tab.id)}
            >
              {tab.label}
            </button>
          )}
        </For>
        <Show when={customTabs().length > 0}>
          <span style="width:1px;background:var(--border);margin:6px 8px" aria-hidden="true" />
        </Show>
        <For each={customTabs()}>
          {(tab) => (
            <button
              type="button"
              role="tab"
              class={`tab ${active() === tab.id ? 'active' : ''}`}
              aria-selected={active() === tab.id}
              onClick={() => switchTo(tab.id)}
              title={tab.title}
            >
              {tab.title}
            </button>
          )}
        </For>
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
        <Show when={activeCustom()}>{(tab) => <CustomTab tab={tab()} />}</Show>
        <Show when={tabErrors().length > 0 && active() === 'runtime'}>
          <div class="card" style="border-color:var(--warn);margin-top:16px">
            <div class="card-title" style="color:var(--warn)">
              {tabErrors().length} custom-tab issue(s)
            </div>
            <ul style="margin:8px 0 0;padding-left:20px;font-family:var(--font-mono);font-size:12px">
              <For each={tabErrors()}>
                {(err) => (
                  <li>
                    {err.source}: {err.reason}
                  </li>
                )}
              </For>
            </ul>
          </div>
        </Show>
      </main>
    </div>
  )
}
