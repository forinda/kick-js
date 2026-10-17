/** The build-time strip follows the devtools flag: a build that keeps DevTools keeps its tabs. */
import { afterEach, describe, expect, it } from 'vitest'
import type { Plugin } from 'vite'
import { kickjsVitePlugin } from '../src/index'

const source = `import { defineDevtoolsTab } from '@forinda/kickjs-devtools-kit'
export const ordersTab = defineDevtoolsTab({ id: 'orders', title: 'Orders' })
`

/** Run the strip plugin `kickjsVitePlugin()` registers, as `vite build` would. */
function stripped(options: Parameters<typeof kickjsVitePlugin>[0] = {}): boolean {
  const strip = kickjsVitePlugin(options).find((p) => p.name === 'kickjs:devtools-strip') as Plugin
  ;(strip.config as Function)({}, { command: 'build', mode: 'production' })
  const result = (strip.transform as Function)(source, '/app/src/tabs.ts')
  return result !== null && result !== undefined
}

describe('kickjs:devtools-strip', () => {
  const saved = process.env.KICKJS_DEVTOOLS
  afterEach(() => {
    if (saved === undefined) delete process.env.KICKJS_DEVTOOLS
    else process.env.KICKJS_DEVTOOLS = saved
  })

  it('strips devtools-kit code from a build without DevTools', () => {
    delete process.env.KICKJS_DEVTOOLS
    expect(stripped()).toBe(true)
  })

  it('keeps it when the build keeps DevTools', () => {
    delete process.env.KICKJS_DEVTOOLS
    expect(stripped({ devtools: { enabled: true } })).toBe(false)
    process.env.KICKJS_DEVTOOLS = '1'
    expect(stripped()).toBe(false)
  })
})
