/**
 * Unit tests for the custom-tab aggregator (PR 5 of §23). Covers
 * validation, dedupe, error collection, and the three view types.
 */

import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { defineAdapter } from '@forinda/kickjs'
import { defineDevtoolsTab } from '@forinda/kickjs-devtools-kit'
import { collectDevtoolsTabs } from '../src/devtools-tabs'
import type { TopologyApplicationLike } from '../src/topology'
import type { AppAdapter, KickPlugin } from '@forinda/kickjs'

function fakeApp(adapters: AppAdapter[], plugins: KickPlugin[] = []): TopologyApplicationLike {
  return {
    getAdapters: () => adapters,
    getPlugins: () => plugins,
  }
}

describe('collectDevtoolsTabs — happy path', () => {
  it('collects iframe / launch / html view tabs verbatim', () => {
    const Three = defineAdapter({
      name: 'ThreeTabsAdapter',
      build: () => ({
        devtoolsTabs: () => [
          defineDevtoolsTab({
            id: 'iframe-tab',
            title: 'Iframe',
            view: { type: 'iframe', src: '/x' },
          }),
          defineDevtoolsTab({
            id: 'launch-tab',
            title: 'Launch',
            view: { type: 'launch', actions: [{ id: 'go', label: 'Run' }] },
          }),
          defineDevtoolsTab({
            id: 'html-tab',
            title: 'HTML',
            view: { type: 'html', html: '<p>hi</p>' },
          }),
        ],
      }),
    })
    const result = collectDevtoolsTabs(fakeApp([Three()]))
    expect(result.tabs.map((t) => t.id)).toEqual(['iframe-tab', 'launch-tab', 'html-tab'])
    expect(result.errors).toEqual([])
  })

  it('returns empty for adapters without devtoolsTabs()', () => {
    const Plain = defineAdapter({ name: 'PlainAdapter', build: () => ({}) })
    const result = collectDevtoolsTabs(fakeApp([Plain()]))
    expect(result.tabs).toEqual([])
    expect(result.errors).toEqual([])
  })

  it('walks both adapters and plugins', () => {
    const Adapter = defineAdapter({
      name: 'A',
      build: () => ({
        devtoolsTabs: () => [
          defineDevtoolsTab({ id: 'a', title: 'A', view: { type: 'iframe', src: '/a' } }),
        ],
      }),
    })
    const plugin: KickPlugin = {
      name: 'P',
      devtoolsTabs: () => [
        defineDevtoolsTab({ id: 'p', title: 'P', view: { type: 'iframe', src: '/p' } }),
      ],
    }
    const result = collectDevtoolsTabs(fakeApp([Adapter()], [plugin]))
    // Plugins enumerated first per the aggregator's walk order
    expect(result.tabs.map((t) => t.id)).toEqual(['p', 'a'])
  })
})

describe('collectDevtoolsTabs — dedupe', () => {
  it('first-source wins on tab.id collision and records a warning', () => {
    const A = defineAdapter({
      name: 'AdapterA',
      build: () => ({
        devtoolsTabs: () => [
          defineDevtoolsTab({ id: 'shared', title: 'A', view: { type: 'iframe', src: '/a' } }),
        ],
      }),
    })
    const B = defineAdapter({
      name: 'AdapterB',
      build: () => ({
        devtoolsTabs: () => [
          defineDevtoolsTab({ id: 'shared', title: 'B', view: { type: 'iframe', src: '/b' } }),
        ],
      }),
    })
    const result = collectDevtoolsTabs(fakeApp([A(), B()]))
    expect(result.tabs).toHaveLength(1)
    expect(result.tabs[0].title).toBe('A')
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].source).toBe('AdapterB')
    expect(result.errors[0].reason).toContain('AdapterA')
  })
})

describe('collectDevtoolsTabs — validation', () => {
  it('drops a tab with non-string id', () => {
    const Bad = defineAdapter({
      name: 'BadAdapter',
      build: () => ({
        devtoolsTabs: () => [{ id: 42, title: 'x', view: { type: 'iframe', src: '/x' } }],
      }),
    })
    const result = collectDevtoolsTabs(fakeApp([Bad()]))
    expect(result.tabs).toEqual([])
    expect(result.errors[0].reason).toMatch(/non-empty string/i)
  })

  it('drops iframe tab with missing src', () => {
    const Bad = defineAdapter({
      name: 'BadAdapter',
      build: () => ({
        devtoolsTabs: () => [{ id: 'a', title: 'A', view: { type: 'iframe' } }],
      }),
    })
    const result = collectDevtoolsTabs(fakeApp([Bad()]))
    expect(result.tabs).toEqual([])
    expect(result.errors[0].reason).toMatch(/iframe view requires/)
  })

  it('drops launch tab with missing actions', () => {
    const Bad = defineAdapter({
      name: 'BadAdapter',
      build: () => ({
        devtoolsTabs: () => [{ id: 'a', title: 'A', view: { type: 'launch' } }],
      }),
    })
    const result = collectDevtoolsTabs(fakeApp([Bad()]))
    expect(result.tabs).toEqual([])
    expect(result.errors[0].reason).toMatch(/launch view requires/)
  })

  it('drops tab with unknown view.type', () => {
    const Bad = defineAdapter({
      name: 'BadAdapter',
      build: () => ({
        devtoolsTabs: () => [{ id: 'a', title: 'A', view: { type: 'wat' } }],
      }),
    })
    const result = collectDevtoolsTabs(fakeApp([Bad()]))
    expect(result.errors[0].reason).toMatch(/iframe \/ launch \/ html/)
  })

  it('records error when devtoolsTabs() throws', () => {
    const Throws = defineAdapter({
      name: 'ThrowingAdapter',
      build: () => ({
        devtoolsTabs: () => {
          throw new Error('contributor blew up')
        },
      }),
    })
    const result = collectDevtoolsTabs(fakeApp([Throws()]))
    expect(result.tabs).toEqual([])
    expect(result.errors[0]).toMatchObject({
      source: 'ThrowingAdapter',
      reason: 'contributor blew up',
    })
  })

  it('records error when devtoolsTabs() returns non-array', () => {
    const Wrong = defineAdapter({
      name: 'WrongAdapter',
      build: () => ({
        devtoolsTabs: (() => ({ not: 'an-array' })) as unknown as () => readonly unknown[],
      }),
    })
    const result = collectDevtoolsTabs(fakeApp([Wrong()]))
    expect(result.errors[0].reason).toMatch(/did not return an array/)
  })
})
