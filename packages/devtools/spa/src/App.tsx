import { createSignal, For, onCleanup, onMount, Show, type Component } from 'solid-js'
import { mountThemeEffect, resolvedTheme, setTheme, themeMode, type ThemeMode } from './lib/theme'
import type { DevtoolsTabDescriptor } from '@forinda/kickjs-devtools-kit'
import { OverviewTab } from './tabs/OverviewTab'
import { RuntimeTab } from './tabs/RuntimeTab'
import { MemoryTab } from './tabs/MemoryTab'
import { TopologyTab } from './tabs/TopologyTab'
import { RoutesTab } from './tabs/RoutesTab'
import { MetricsTab } from './tabs/MetricsTab'
import { ContainerTab } from './tabs/ContainerTab'
import { QueuesTab } from './tabs/QueuesTab'
import { DatabaseTab } from './tabs/DatabaseTab'
import { GraphTab } from './tabs/GraphTab'
import { ActivityLogTab } from './tabs/ActivityLogTab'
import { CustomTab } from './tabs/CustomTab'
import { rpc } from './lib/rpc'
import { startUnifiedStream } from './lib/unified-stream'
import { bootBus, recentBusEvents } from './lib/bus'
import { store } from './lib/store'
import { DetailModalHost } from './lib/detail-modal'
import { AuthGate } from './lib/auth-gate'

type BuiltInTabId =
  | 'overview'
  | 'runtime'
  | 'memory'
  | 'topology'
  | 'routes'
  | 'metrics'
  | 'container'
  | 'queues'
  | 'database'
  | 'graph'
  | 'activity'

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
    { id: 'overview', label: 'Overview' },
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
    {
      id: 'queues',
      label: 'Queues',
      count: () => store.queues().queues.length || undefined,
    },
    {
      id: 'database',
      label: 'Database',
      count: () =>
        recentBusEvents()().filter((e) => e.type === 'db:query' || e.type === 'db:query-error')
          .length || undefined,
    },
    {
      id: 'graph',
      label: 'Graph',
      count: () => store.container().length || undefined,
    },
    {
      id: 'activity',
      label: 'Activity',
      count: () => recentBusEvents()().length || undefined,
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
    return 'overview'
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
    // Boot the singleton browser bus too — eager so the activity log
    // captures events emitted before the user opens the tab.
    const disposeBus = bootBus()
    onCleanup(() => {
      dispose?.()
      disposeBus()
    })

    // Apply data-theme to <html> on every resolved-theme change.
    mountThemeEffect()
  })

  const switchTo = (id: string): void => {
    setActive(id)
    try {
      localStorage.setItem('kickjs-devtools-tab', id)
    } catch {
      // ignore
    }
    // Scroll the activated tab into view — important on narrow
    // viewports where the tab bar overflows; otherwise a programmatic
    // switch (or a localStorage restore) lands on a tab the user
    // can't see without manually scrolling first.
    queueMicrotask(() => {
      const el = document.querySelector(`[role="tab"][data-tab-id="${id}"]`)
      el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
    })
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
        <div style="display:flex;align-items:center;gap:12px;">
          <ConnectionPill />
          <ThemeToggle />
        </div>
      </header>
      <nav class="tabs" role="tablist">
        <For each={BUILT_INS}>
          {(tab) => (
            <button
              type="button"
              role="tab"
              data-tab-id={tab.id}
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
              data-tab-id={tab.id}
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
        <Show when={active() === 'overview'}>
          <OverviewTab />
        </Show>
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
        <Show when={active() === 'queues'}>
          <QueuesTab />
        </Show>
        <Show when={active() === 'database'}>
          <DatabaseTab />
        </Show>
        <Show when={active() === 'graph'}>
          <GraphTab />
        </Show>
        <Show when={active() === 'activity'}>
          <ActivityLogTab />
        </Show>
        <Show when={activeCustom()}>{(tab) => <CustomTab tab={tab()} />}</Show>
        <Show when={tabErrors().length > 0 && active() === 'overview'}>
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
      <AuthGate />
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

/**
 * Three-state theme toggle: cycles `system → light → dark → system`.
 * Single button keeps the header tight; long-press / right-click could
 * surface an explicit menu later if the cycling proves confusing.
 *
 * Icon reflects the *resolved* theme (what's painted), not the picked
 * mode — so `system` shows whichever the OS resolved to. The aria
 * label spells out the picked mode for screen readers.
 */
const ThemeToggle: Component = () => {
  const cycle = (): void => {
    const next: ThemeMode =
      themeMode() === 'system' ? 'light' : themeMode() === 'light' ? 'dark' : 'system'
    setTheme(next)
  }
  const aria = (): string => {
    const m = themeMode()
    return `Theme: ${m === 'system' ? 'follow system' : m} (click to cycle)`
  }
  return (
    <button
      type="button"
      class="dt-theme-toggle"
      onClick={cycle}
      aria-label={aria()}
      title={aria()}
    >
      <Show
        when={resolvedTheme() === 'dark'}
        fallback={
          // Sun icon — light mode active
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </svg>
        }
      >
        {/* Moon icon — dark mode active */}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      </Show>
    </button>
  )
}
