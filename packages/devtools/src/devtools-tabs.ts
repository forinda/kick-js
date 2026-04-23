/**
 * Custom-tab aggregator — collects every plugin/adapter's
 * `devtoolsTabs()` contribution into a single deduped list for the
 * panel's `/_debug/tabs` endpoint.
 *
 * Validation is permissive: anything that doesn't look like a
 * {@link DevtoolsTabDescriptor} is dropped with a console warning
 * rather than throwing — a misconfigured adapter shouldn't break the
 * whole DevTools panel.
 *
 * @module @forinda/kickjs-devtools/devtools-tabs
 */

import type { DevtoolsTabDescriptor } from '@forinda/kickjs-devtools-kit'
import type { TopologyApplicationLike } from './topology'

/** Result of {@link collectDevtoolsTabs}. */
export interface DevtoolsTabsResult {
  /** Deduped, validated tabs in registration order. */
  tabs: DevtoolsTabDescriptor[]
  /** Per-source collection errors (drop reason, source name). */
  errors: ReadonlyArray<{ source: string; reason: string }>
}

const VALID_VIEW_TYPES = new Set(['iframe', 'launch', 'html'])

/**
 * Walk every plugin + adapter, call `devtoolsTabs?()`, validate each
 * entry, and dedupe by `id`. Last-source-wins on collision is too
 * surprising — first-source-wins + a warning entry instead.
 */
export function collectDevtoolsTabs(app: TopologyApplicationLike): DevtoolsTabsResult {
  const tabs: DevtoolsTabDescriptor[] = []
  const seen = new Map<string, string>() // id → source name (for collision warnings)
  const errors: Array<{ source: string; reason: string }> = []

  const ingest = (sourceName: string, raw: unknown): void => {
    if (!Array.isArray(raw)) {
      errors.push({ source: sourceName, reason: 'devtoolsTabs() did not return an array' })
      return
    }
    for (const entry of raw) {
      const validation = validateTab(entry)
      if (!validation.ok) {
        errors.push({ source: sourceName, reason: validation.reason })
        continue
      }
      const tab = validation.tab
      const owner = seen.get(tab.id)
      if (owner) {
        errors.push({
          source: sourceName,
          reason: `tab id '${tab.id}' already registered by ${owner} — first-source wins`,
        })
        continue
      }
      seen.set(tab.id, sourceName)
      tabs.push(tab)
    }
  }

  for (const plugin of app.getPlugins()) {
    if (typeof plugin.devtoolsTabs !== 'function') continue
    try {
      ingest(plugin.name ?? '(unnamed plugin)', plugin.devtoolsTabs())
    } catch (err) {
      errors.push({
        source: plugin.name ?? '(unnamed plugin)',
        reason: err instanceof Error ? err.message : String(err),
      })
    }
  }
  for (const adapter of app.getAdapters()) {
    if (typeof adapter.devtoolsTabs !== 'function') continue
    try {
      ingest(adapter.name ?? '(unnamed adapter)', adapter.devtoolsTabs())
    } catch (err) {
      errors.push({
        source: adapter.name ?? '(unnamed adapter)',
        reason: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { tabs, errors }
}

interface ValidationOk {
  ok: true
  tab: DevtoolsTabDescriptor
}

interface ValidationFail {
  ok: false
  reason: string
}

/**
 * Coerce + validate a tab descriptor. Returns the typed object on
 * success; a structured reason on failure. Uses a permissive checker
 * so a partially-correct entry from a third-party adapter doesn't
 * break the whole panel.
 */
function validateTab(raw: unknown): ValidationOk | ValidationFail {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'tab entry is not an object' }
  }
  const obj = raw as Record<string, unknown>
  if (typeof obj.id !== 'string' || obj.id.length === 0) {
    return { ok: false, reason: 'tab.id must be a non-empty string' }
  }
  if (typeof obj.title !== 'string' || obj.title.length === 0) {
    return { ok: false, reason: `tab '${obj.id}': title must be a non-empty string` }
  }
  const view = obj.view as Record<string, unknown> | undefined
  if (!view || typeof view !== 'object') {
    return { ok: false, reason: `tab '${obj.id}': view object is required` }
  }
  if (typeof view.type !== 'string' || !VALID_VIEW_TYPES.has(view.type)) {
    return {
      ok: false,
      reason: `tab '${obj.id}': view.type must be one of iframe / launch / html`,
    }
  }
  switch (view.type) {
    case 'iframe':
      if (typeof view.src !== 'string' || view.src.length === 0) {
        return { ok: false, reason: `tab '${obj.id}': iframe view requires a non-empty src` }
      }
      break
    case 'html':
      if (typeof view.html !== 'string') {
        return { ok: false, reason: `tab '${obj.id}': html view requires html string` }
      }
      break
    case 'launch':
      if (!Array.isArray(view.actions)) {
        return { ok: false, reason: `tab '${obj.id}': launch view requires actions array` }
      }
      break
  }
  return { ok: true, tab: obj as unknown as DevtoolsTabDescriptor }
}
