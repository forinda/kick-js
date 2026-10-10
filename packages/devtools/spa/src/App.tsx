import { createSignal, For, onCleanup, onMount, Show, type Component } from 'solid-js'
import { mountThemeEffect, resolvedTheme, setTheme, themeMode, type ThemeMode } from './lib/theme'
import { densityMode, setDensity, mountDensityEffect, type DensityMode } from './lib/density'
import { fontOverrides, mountFontEffect, setFont } from './lib/fonts'
import type { DevtoolsTabDescriptor } from '@forinda/kickjs-devtools-kit'
import { OverviewTab } from './tabs/OverviewTab'
import { RuntimeTab } from './tabs/RuntimeTab'
import { TopologyTab } from './tabs/TopologyTab'
import { RoutesTab } from './tabs/RoutesTab'
import { RequestsTab } from './tabs/RequestsTab'
import { MetricsTab } from './tabs/MetricsTab'
import { ContainerTab } from './tabs/ContainerTab'
import { JobsTab } from './tabs/JobsTab'
import { SocketsTab } from './tabs/SocketsTab'
import { DatabaseTab } from './tabs/DatabaseTab'
import { ActivityLogTab } from './tabs/ActivityLogTab'
import { CustomTab } from './tabs/CustomTab'
import { rpc } from './lib/rpc'
import { startUnifiedStream } from './lib/unified-stream'
import { startTrafficSampler } from './lib/traffic'
import { bootBus, recentBusEvents } from './lib/bus'
import { store } from './lib/store'
import { activeTab, MERGED_TABS, switchTab } from './lib/nav'
import { Icon } from './lib/icons'
import { AuthGate } from './lib/auth-gate'
import { CommandPalette, openCommandPalette } from './lib/command-palette'
import type { PaletteItem } from './lib/palette-core'
import { openApiRunner } from './lib/api-runner'
import { openToken } from './lib/token-detail'

type BuiltInTabId =
  | 'overview'
  | 'runtime'
  | 'routes'
  | 'sockets'
  | 'requests'
  | 'metrics'
  | 'container'
  | 'queues'
  | 'database'
  | 'activity'

interface BuiltInTabSpec {
  id: BuiltInTabId
  label: string
  /** Reactive count thunk; renders as a badge next to the tab label when truthy. */
  count?: () => number | undefined
  /** Fed only by optional sources — dimmed in the sidebar while its count is empty. */
  quiet?: true
}

/** Sidebar title and dimming for a built-in tab with nothing to show yet. */
function idle(t: BuiltInTabSpec, active: boolean): boolean {
  return !!t.quiet && !active && !t.count?.()
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
    { id: 'routes', label: 'Routes', count: () => store.routes().length || undefined },
    {
      id: 'sockets',
      label: 'Sockets',
      quiet: true,
      count: () => Object.keys(store.ws().namespaces ?? {}).length || undefined,
    },
    { id: 'metrics', label: 'Metrics' },
    { id: 'requests', label: 'Requests' },
    {
      id: 'container',
      label: 'Container',
      count: () => store.container().length || undefined,
    },
    {
      id: 'queues',
      label: 'Jobs',
      quiet: true,
      count: () => store.queues().queues.length + store.cron().length || undefined,
    },
    {
      id: 'database',
      label: 'Database',
      quiet: true,
      count: () =>
        recentBusEvents()().filter((e) => e.type === 'db:query' || e.type === 'db:query-error')
          .length || undefined,
    },
    {
      id: 'activity',
      label: 'Activity',
      quiet: true,
      count: () => recentBusEvents()().length || undefined,
    },
  ]
}

/** Reserved built-in IDs so a custom tab can't shadow them. */
const RESERVED: ReadonlySet<string> = new Set([
  ...builtInTabs().map((t) => t.id),
  ...Object.keys(MERGED_TABS),
])

/**
 * Sidebar grouping of the built-in tabs. A `label: null` group renders its
 * items flat (no header); labelled groups render a collapsible section. The
 * order here is the sidebar order.
 */
interface TabGroup {
  label: string | null
  ids: readonly BuiltInTabId[]
}
const TAB_GROUPS: readonly TabGroup[] = [
  { label: null, ids: ['overview'] },
  { label: 'Runtime', ids: ['runtime', 'metrics', 'requests'] },
  { label: 'Architecture', ids: ['routes', 'sockets', 'container'] },
  { label: 'Data & Jobs', ids: ['database', 'queues'] },
  { label: null, ids: ['activity'] },
]

const SIDEBAR_WIDTH_KEY = 'kickjs-devtools-sidebar-w'
const RAIL_KEY = 'kickjs-devtools-sidebar-mode'
/** Tabs that lay out their own panes and fill the main area. */
const FLUSH_TABS: ReadonlySet<string> = new Set([
  'routes',
  'sockets',
  'requests',
  'container',
  'activity',
  'database',
  'queues',
])
const SIDEBAR_COLLAPSED_KEY = 'kickjs-devtools-sidebar-collapsed'
const SIDEBAR_MIN = 150
const SIDEBAR_MAX = 360

function readSidebarWidth(): number {
  try {
    const raw = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY))
    if (raw >= SIDEBAR_MIN && raw <= SIDEBAR_MAX) return raw
  } catch {
    // ignore
  }
  return 200
}

function readCollapsedGroups(): string[] {
  try {
    const raw = localStorage.getItem(SIDEBAR_COLLAPSED_KEY)
    if (raw) return JSON.parse(raw) as string[]
  } catch {
    // ignore
  }
  return []
}

export const App: Component = () => {
  const active = activeTab
  // Icon rail by default — labels on demand. Remembered per browser.
  const [rail, setRail] = createSignal(
    (() => {
      try {
        return localStorage.getItem(RAIL_KEY) !== 'full'
      } catch {
        return true
      }
    })(),
  )
  const toggleRail = (): void => {
    const next = !rail()
    setRail(next)
    try {
      localStorage.setItem(RAIL_KEY, next ? 'rail' : 'full')
    } catch {
      // storage unavailable
    }
  }
  const [customTabs, setCustomTabs] = createSignal<DevtoolsTabDescriptor[]>([])
  const [tabErrors, setTabErrors] = createSignal<ReadonlyArray<{ source: string; reason: string }>>(
    [],
  )

  const BUILT_INS = builtInTabs()
  const byId = new Map(BUILT_INS.map((t) => [t.id, t] as const))
  const [sidebarWidth, setSidebarWidth] = createSignal(readSidebarWidth())
  const [collapsed, setCollapsed] = createSignal<string[]>(readCollapsedGroups())

  const toggleGroup = (label: string): void => {
    setCollapsed((prev) => {
      const next = prev.includes(label) ? prev.filter((g) => g !== label) : [...prev, label]
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, JSON.stringify(next))
      } catch {
        // ignore
      }
      return next
    })
  }

  // Teardown for an in-flight resize drag — set while dragging, cleared on
  // release. A single component-level onCleanup (below) calls it so the
  // window listeners + cursor don't leak if we unmount mid-drag.
  let endResize: (() => void) | null = null
  onCleanup(() => endResize?.())

  // Drag the divider to resize the sidebar; persist on release.
  const startResize = (e: MouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startW = sidebarWidth()
    document.body.style.cursor = 'col-resize'
    const onMove = (ev: MouseEvent): void => {
      const w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startW + (ev.clientX - startX)))
      setSidebarWidth(w)
    }
    const teardown = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      endResize = null
    }
    const onUp = (): void => {
      teardown()
      try {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth()))
      } catch {
        // ignore
      }
    }
    endResize = teardown
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  onMount(() => {
    void rpc
      .tabs()
      .then(({ tabs, errors }) => {
        setCustomTabs(tabs.filter((t) => !RESERVED.has(t.id)))
        setTabErrors(errors)
      })
      .catch(() => {
        // Tabs endpoint may 503 during startup — silent fall back to
        // built-ins-only. The Runtime tab's plugin list will surface the same
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
    const stopSampler = startTrafficSampler()
    onCleanup(() => {
      dispose?.()
      disposeBus()
      stopSampler()
    })

    // Apply data-theme + data-density to <html> on change.
    mountThemeEffect()
    mountDensityEffect()
    mountFontEffect()
  })

  const switchTo = (id: string): void => {
    switchTab(id)
    // Scroll the activated tab into view — important on narrow
    // viewports where the tab bar overflows; otherwise a programmatic
    // switch (or a localStorage restore) lands on a tab the user
    // can't see without manually scrolling first.
    queueMicrotask(() => {
      const el = document.querySelector(`[role="tab"][data-tab-id="${id}"]`)
      el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
    })
  }

  const paletteItems = (): PaletteItem[] => [
    ...BUILT_INS.map((t) => ({
      id: `tab:${t.id}`,
      title: t.label,
      group: 'Tabs',
      icon: t.id,
      run: () => switchTo(t.id),
    })),
    ...customTabs().map((t) => ({
      id: `tab:${t.id}`,
      title: t.title,
      group: 'Tabs',
      icon: 'custom',
      run: () => switchTo(t.id),
    })),
    ...store.routes().map((r) => ({
      id: `route:${r.method} ${r.path}`,
      title: `${r.method} ${r.path}`,
      description: `${r.controller}.${r.handler}`,
      group: 'Routes',
      icon: 'routes',
      run: () => openApiRunner(r),
    })),
    ...store.container().map((c) => ({
      id: `token:${c.token}`,
      title: c.token,
      description: [c.kind, c.scope].filter(Boolean).join(' · '),
      group: 'DI tokens',
      icon: 'container',
      run: () => openToken(c.token),
    })),
    ...(['system', 'light', 'dark'] as const).map((mode) => ({
      id: `theme:${mode}`,
      title: `Theme: ${mode}`,
      group: 'Actions',
      icon: 'action',
      run: () => setTheme(mode),
    })),
    ...(['sm', 'md', 'lg'] as const).map((d) => ({
      id: `density:${d}`,
      title: `Density: ${d}`,
      group: 'Actions',
      icon: 'action',
      run: () => setDensity(d),
    })),
  ]

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
          <button
            type="button"
            class="flex cursor-pointer items-center gap-2 rounded-md border border-border-strong bg-surface-2 px-2.5 py-1 text-xs text-text-muted hover:text-text-strong"
            onClick={openCommandPalette}
          >
            <Icon name="search" size={13} />
            Search
            <kbd class="dt-kbd">⌘K</kbd>
          </button>
          <ConnectionPill />
          <ThemeToggle />
          <SettingsMenu />
        </div>
      </header>
      <div class="dt-shell">
        <aside
          class={`dt-sidebar ${rail() ? 'rail' : ''}`}
          role="tablist"
          style={`width:${sidebarWidth()}px`}
        >
          <For each={TAB_GROUPS}>
            {(group) => (
              <Show
                when={group.label}
                fallback={
                  <For each={group.ids}>
                    {(id) => {
                      const tab = byId.get(id)
                      return (
                        <Show when={tab}>
                          {(t) => (
                            <button
                              type="button"
                              role="tab"
                              data-tab-id={id}
                              class={`dt-nav-item ${active() === id ? 'active' : ''} ${
                                idle(t(), active() === id) ? 'opacity-50' : ''
                              }`}
                              aria-selected={active() === id}
                              aria-label={t().label}
                              title={
                                idle(t(), active() === id)
                                  ? `${t().label} — nothing reported yet`
                                  : t().label
                              }
                              onClick={() => switchTo(id)}
                            >
                              <span class="dt-nav-main">
                                <Icon name={id} />
                                <span class="dt-nav-label">{t().label}</span>
                              </span>
                              <Show when={t().count?.()}>
                                {(n) => <span class="tab-badge">{n()}</span>}
                              </Show>
                            </button>
                          )}
                        </Show>
                      )
                    }}
                  </For>
                }
              >
                {(label) => (
                  <div class="dt-nav-group">
                    <Show when={rail()}>
                      <div class="dt-nav-sep" />
                    </Show>
                    <button
                      hidden={rail()}
                      type="button"
                      class="dt-nav-group-header"
                      aria-expanded={!collapsed().includes(label())}
                      onClick={() => toggleGroup(label())}
                    >
                      <span class={`dt-nav-caret ${collapsed().includes(label()) ? 'closed' : ''}`}>
                        ▾
                      </span>
                      {label()}
                    </button>
                    <Show when={rail() || !collapsed().includes(label())}>
                      <For each={group.ids}>
                        {(id) => {
                          const tab = byId.get(id)
                          return (
                            <Show when={tab}>
                              {(t) => (
                                <button
                                  type="button"
                                  role="tab"
                                  data-tab-id={id}
                                  class={`dt-nav-item nested ${active() === id ? 'active' : ''} ${
                                    idle(t(), active() === id) ? 'opacity-50' : ''
                                  }`}
                                  aria-selected={active() === id}
                                  aria-label={t().label}
                                  title={
                                    idle(t(), active() === id)
                                      ? `${t().label} — nothing reported yet`
                                      : t().label
                                  }
                                  onClick={() => switchTo(id)}
                                >
                                  <span class="dt-nav-main">
                                    <Icon name={id} />
                                    <span class="dt-nav-label">{t().label}</span>
                                  </span>
                                  <Show when={t().count?.()}>
                                    {(n) => <span class="tab-badge">{n()}</span>}
                                  </Show>
                                </button>
                              )}
                            </Show>
                          )
                        }}
                      </For>
                    </Show>
                  </div>
                )}
              </Show>
            )}
          </For>
          <Show when={customTabs().length > 0}>
            <div class="dt-nav-sep" />
            <For each={customTabs()}>
              {(tab) => (
                <button
                  type="button"
                  role="tab"
                  data-tab-id={tab.id}
                  class={`dt-nav-item ${active() === tab.id ? 'active' : ''}`}
                  aria-selected={active() === tab.id}
                  aria-label={tab.title}
                  onClick={() => switchTo(tab.id)}
                  title={tab.title}
                >
                  <span class="dt-nav-main">
                    <Icon name="custom" />
                    <span class="dt-nav-label">{tab.title}</span>
                  </span>
                </button>
              )}
            </For>
          </Show>
          <div class="dt-sidebar-foot">
            <button
              type="button"
              class="dt-rail-toggle"
              onClick={toggleRail}
              title={rail() ? 'Show labels' : 'Icons only'}
              aria-label={rail() ? 'Show labels' : 'Icons only'}
            >
              <Icon name={rail() ? 'expand' : 'collapse'} size={16} />
            </button>
          </div>
        </aside>
        <Show when={!rail()}>
          <div
            class="dt-resizer"
            role="separator"
            aria-orientation="vertical"
            onMouseDown={startResize}
          />
        </Show>
        <main class={`dt-main ${FLUSH_TABS.has(active()) ? 'flush' : ''}`} role="tabpanel">
          <Show when={active() === 'overview'}>
            <OverviewTab />
          </Show>
          <Show when={active() === 'runtime'}>
            <div class="flex flex-col gap-6">
              <RuntimeTab />
              <TopologyTab />
            </div>
          </Show>
          <Show when={active() === 'routes'}>
            <RoutesTab />
          </Show>
          <Show when={active() === 'sockets'}>
            <SocketsTab />
          </Show>
          <Show when={active() === 'requests'}>
            <RequestsTab />
          </Show>
          <Show when={active() === 'metrics'}>
            <MetricsTab />
          </Show>
          <Show when={active() === 'container'}>
            <ContainerTab />
          </Show>
          <Show when={active() === 'queues'}>
            <JobsTab />
          </Show>
          <Show when={active() === 'database'}>
            <DatabaseTab />
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
      </div>
      <CommandPalette items={paletteItems} />
      <AuthGate />
      <Show when={store.connectionStatus() === 'disconnected' && !store.authRequired()}>
        <div
          class="fixed bottom-4 left-1/2 z-60 flex -translate-x-1/2 items-center gap-2.5 rounded-md border border-red-500/40 bg-surface-1 px-3.5 py-2 text-[0.8rem] shadow-xl"
          role="status"
        >
          <span class="dt-pulse dt-pulse-disconnected" aria-hidden="true" />
          Can't reach the app — retrying every few seconds…
        </div>
      </Show>
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
/**
 * Settings menu — a gear button that opens a popover. Houses the density
 * control (and future preferences). A gear is the conventional, discoverable
 * home for settings, unlike a bare "SM" toggle. Closes on outside-click / Esc.
 */
const DENSITY_OPTS: ReadonlyArray<{ id: DensityMode; label: string }> = [
  { id: 'sm', label: 'Small' },
  { id: 'md', label: 'Medium' },
  { id: 'lg', label: 'Large' },
]

const SettingsMenu: Component = () => {
  const [open, setOpen] = createSignal(false)
  let root: HTMLDivElement | undefined

  const onDocClick = (e: MouseEvent): void => {
    if (open() && root && !root.contains(e.target as Node)) setOpen(false)
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') setOpen(false)
  }
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKey)
  onCleanup(() => {
    document.removeEventListener('click', onDocClick)
    document.removeEventListener('keydown', onKey)
  })

  return (
    <div class="dt-settings" ref={(el) => (root = el)}>
      <button
        type="button"
        class={`dt-settings-btn ${open() ? 'open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label="Settings"
        aria-haspopup="true"
        aria-expanded={open()}
        title="Settings"
      >
        {/* Gear icon */}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      <Show when={open()}>
        <div class="dt-settings-pop" role="menu">
          <div class="dt-settings-section">
            <div class="dt-settings-label">Density</div>
            <div class="dt-seg">
              <For each={DENSITY_OPTS}>
                {(opt) => (
                  <button
                    type="button"
                    class={`dt-seg-item ${densityMode() === opt.id ? 'active' : ''}`}
                    aria-pressed={densityMode() === opt.id}
                    onClick={() => setDensity(opt.id)}
                  >
                    {opt.label}
                  </button>
                )}
              </For>
            </div>
            <div class="dt-settings-hint">Controls spacing &amp; font scale. Default: Small.</div>
          </div>
          <div class="dt-settings-section">
            <div class="dt-settings-label">Fonts</div>
            <For
              each={
                [
                  ['sans', 'Interface', 'e.g. Inter'],
                  ['mono', 'Code & editors', 'e.g. JetBrains Mono'],
                ] as const
              }
            >
              {([slot, label, placeholder]) => (
                <label class="dt-settings-field">
                  <span>{label}</span>
                  <input
                    type="text"
                    spellcheck={false}
                    placeholder={placeholder}
                    value={fontOverrides()[slot]}
                    onInput={(e) => setFont(slot, e.currentTarget.value)}
                  />
                </label>
              )}
            </For>
            <div class="dt-settings-hint">
              Fonts installed on this computer, comma-separated. Ours stay as the fallback, so a
              name that isn't installed changes nothing. Empty = default.
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}

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
