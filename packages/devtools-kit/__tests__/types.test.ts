import { describe, it, expect } from 'vitest'
import {
  PROTOCOL_VERSION,
  defineDevtoolsTab,
  type DevtoolsTabDescriptor,
  type IntrospectionSnapshot,
} from '../src'

describe('PROTOCOL_VERSION', () => {
  it('starts at 1 and is a const', () => {
    expect(PROTOCOL_VERSION).toBe(1)
  })
})

describe('defineDevtoolsTab', () => {
  it('returns the spec verbatim', () => {
    const spec: DevtoolsTabDescriptor = {
      id: 'queue',
      title: 'Queue',
      view: { type: 'iframe', src: '/_kick/queue/panel' },
    }
    expect(defineDevtoolsTab(spec)).toBe(spec)
  })

  it('accepts launch view with action list', () => {
    const tab = defineDevtoolsTab({
      id: 'cron',
      title: 'Cron',
      view: {
        type: 'launch',
        actions: [{ id: 'run-now', label: 'Run all jobs now' }],
      },
    })
    expect(tab.view.type).toBe('launch')
  })

  it('accepts inline html view', () => {
    const tab = defineDevtoolsTab({
      id: 'banner',
      title: 'Banner',
      view: { type: 'html', html: '<h1>hi</h1>' },
    })
    expect(tab.view.type).toBe('html')
  })

  it('preserves built-in category autocomplete via string & {} brand', () => {
    const tab = defineDevtoolsTab({
      id: 'q',
      title: 'Q',
      category: 'observability',
      view: { type: 'iframe', src: '/x' },
    })
    expect(tab.category).toBe('observability')
    // Arbitrary string still type-checks at compile time
    const custom = defineDevtoolsTab({
      id: 'q',
      title: 'Q',
      category: 'mycorp-tab',
      view: { type: 'iframe', src: '/x' },
    })
    expect(custom.category).toBe('mycorp-tab')
  })
})

describe('IntrospectionSnapshot — type assertions', () => {
  it('accepts a minimal snapshot (just protocol + name + kind)', () => {
    const snap: IntrospectionSnapshot = {
      protocolVersion: PROTOCOL_VERSION,
      name: 'TenantAdapter',
      kind: 'adapter',
    }
    expect(snap.kind).toBe('adapter')
  })

  it('accepts a fully populated snapshot', () => {
    const snap: IntrospectionSnapshot = {
      protocolVersion: PROTOCOL_VERSION,
      name: 'QueueAdapter',
      kind: 'adapter',
      version: '3.2.0',
      state: { strategy: 'redis', concurrency: 3 },
      tokens: { provides: ['kick/queue/Manager'], requires: [] },
      metrics: { activeWorkers: 3, pendingJobs: 12 },
      memoryBytes: 1024 * 1024,
    }
    expect(snap.metrics?.pendingJobs).toBe(12)
  })
})
