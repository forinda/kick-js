import { createSignal, For, onCleanup, onMount, Show, type Component } from 'solid-js'
import type { DevtoolsTabDescriptor } from '@forinda/kickjs-devtools-kit'
import { RuntimeTab } from './tabs/RuntimeTab'
import { MemoryTab } from './tabs/MemoryTab'
import { TopologyTab } from './tabs/TopologyTab'
import { RoutesTab } from './tabs/RoutesTab'
import { MetricsTab } from './tabs/MetricsTab'
import { ContainerTab } from './tabs/ContainerTab'
import { CustomTab } from './tabs/CustomTab'
import { rpc } from './lib/rpc'
import { startUnifiedStream } from './lib/unified-stream'
import { store } from './lib/store'
import { DetailModalHost } from './lib/detail-modal'

type BuiltInTabId = 'runtime' | 'memory' | 'topology' | 'routes' | 'metrics' | 'container'

interface BuiltInTabSpec {
  id: BuiltInTabId
  label: string
  /** Reactive count thunk; renders as a badge next to the tab label when truthy. */
  count?: () => number | undefined
}

/**
 * Build the static built-in tab list. `count` is a thunk so each tab
 * keeps its own reactive read of the shared store; the App body just
 * renders whatever number is current.
 */
function builtInTabs(): readonly BuiltInTabSpec[] {
  return [
    { id: 'runtime', label: 'Runtime' },
    { id: 'memory', label: 'Memory' },
    { id: 'topology', label: 'Topology' },
    { id: 'routes', label: 'Routes', count: () => store.routes().length || undefined },
    { id: 'metrics', label: 'Metrics' },
    {
      id: 'container',
      label: 'Container',
      count: () => store.container().length || undefined,
    },
  ]
}

/** Reserved built-in IDs so a custom tab can't shadow them. */
const RESERVED: ReadonlySet<string> = new Set(builtInTabs().map((t) => t.id))

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

  const BUILT_INS = builtInTabs()

  onMount(() => {
    void rpc
      .tabs()
      .then(({ tabs, errors }) => {
        setCustomTabs(tabs.filter((t) => !RESERVED.has(t.id)))
        setTabErrors(errors)
      })
      .catch(() => {
        // Tabs endpoint may 503 during startup — silent fall back to
        // built-ins-only. The Topology tab will surface the same
        // error if the issue is persistent.
      })

    // Boot the shared SSE consumer + initial snapshot. Tabs read from
    // `store` and never own their own polling/subscription anymore.
    let dispose: (() => void) | null = null
    void startUnifiedStream().then((d) => {
      dispose = d
    })
    onCleanup(() => dispose?.())
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
      <header class="dt-header">
        <div class="dt-header-brand">
          <span class="dt-bolt" aria-hidden="true">
            ⚡
          </span>
          <h1>KickJS DevTools</h1>
        </div>
        <ConnectionPill />
      </header>
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
              <Show when={tab.count?.()}>{(n) => <span class="tab-badge">{n()}</span>}</Show>
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
        <Show when={active() === 'metrics'}>
          <MetricsTab />
        </Show>
        <Show when={active() === 'container'}>
          <ContainerTab />
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
      <DetailModalHost />
    </div>
  )
}

/**
 * Live-status pill in the header. Mirrors the legacy Vue dashboard:
 * green pulse "Live" when SSE is connected, amber pulse "Polling"
 * after a fallback, grey "Connecting…" before first response, red
 * "Disconnected" after teardown. The trailing "Updated HH:MM:SS"
 * tells the user the page isn't frozen even when nothing is changing.
 */
const ConnectionPill: Component = () => {
  const labelFor = (s: ReturnType<typeof store.connectionStatus>): string => {
    if (s === 'live') return 'Live'
    if (s === 'polling') return 'Polling'
    if (s === 'disconnected') return 'Disconnected'
    return 'Connecting…'
  }
  const fmt = (d: Date | null): string => {
    if (!d) return 'never'
    return d.toLocaleTimeString()
  }
  return (
    <div class="dt-conn">
      <span class={`dt-pulse dt-pulse-${store.connectionStatus()}`} aria-hidden="true" />
      <span class="dt-conn-label">{labelFor(store.connectionStatus())}</span>
      <span class="dt-conn-sep">·</span>
      <span class="dt-conn-ts">Updated {fmt(store.lastUpdate())}</span>
    </div>
  )
}
