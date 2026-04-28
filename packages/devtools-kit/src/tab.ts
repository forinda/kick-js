// M2.C — render-based DevTools tab contract.
//
// Coexists with the legacy `DevtoolsTabDescriptor` ({ id, title, view })
// surface in `./types.ts`. New tabs use `defineDevtoolsRenderTab` and
// the panel mounts them by calling `render(el, props)`. Existing
// descriptor-based tabs keep working unchanged; migration is one tab
// at a time.
//
// Why a render function:
//   - dynamic content driven by event-bus subscriptions (slow queries,
//     route hits) — descriptors only support static HTML/iframe/launch
//   - co-located teardown via the optional return cleanup function,
//     so subscriptions don't leak when the tab unmounts
//   - safe DOM construction patterns — adopters use createElement +
//     textContent rather than innerHTML, removing an XSS class entirely
//
// Naming: the render-based factory is `defineDevtoolsRenderTab` to
// avoid overloading `defineDevtoolsTab` (which would force adopters to
// understand the discrimination at every call site). Once descriptor-
// based tabs deprecate (post-migration), the canonical name folds back
// to `defineDevtoolsTab`.

import type { KickEventBus } from './bus/types'

/**
 * Runtime knobs the panel passes into every tab — theme, layout, etc.
 * Stable surface adopters can rely on across DevTools versions.
 */
export interface TabRuntimeConfig {
  theme: 'dark' | 'light'
  /** Pixel height of the panel — tabs that render charts use this for layout. */
  panelHeight: number
}

/**
 * Props handed to `render(el, props)`. Generic so adopter tabs can
 * widen with their own props (e.g. an injected services map) — the
 * default shape is what every tab gets.
 */
export interface TabProps {
  /** Runtime event bus — subscribe via `props.bus.on('event:name', ...)`. */
  bus: KickEventBus
  /** Theme + layout config. */
  config: TabRuntimeConfig
  /** URL state — tabs that route via the hash read this. */
  query: URLSearchParams
}

/**
 * Render-based tab spec. The panel calls `render(el, props)` once on
 * mount; the optional return value is invoked on unmount for cleanup
 * (unsubscribe from the bus, clear timers, etc.).
 *
 * @template TProps — extend `TabProps` if the tab needs additional
 * runtime context. Default = `TabProps`.
 */
export interface DevtoolsRenderTab<TProps = TabProps> {
  /** Stable id — used in URL hash + as a panel key. */
  id: string
  /** Display name. Function form lets the tab paint its own header
   * (e.g. with a live counter); string form is the common case. */
  name: string | ((el: HTMLElement) => void)
  /** Optional badge — small adornment in the tab strip (count, dot). */
  badge?: () => string | number | null
  /**
   * Render the tab into `el`. Return a cleanup function to run on
   * unmount; return `void` if there's nothing to tear down.
   */
  render: (el: HTMLElement, props: TProps) => void | (() => void)
  /** Open this tab on first DevTools mount. Default: false. */
  defaultOpen?: boolean
}

/** Identity factory — exists for type inference + IDE hover docs. */
export function defineDevtoolsRenderTab<TProps = TabProps>(
  spec: DevtoolsRenderTab<TProps>,
): DevtoolsRenderTab<TProps> {
  return spec
}
