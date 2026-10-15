import { afterEach, expect, it, vi } from 'vitest'

const KEY = Symbol.for('@forinda/kickjs-di:loaded-from')
const store = globalThis as Record<symbol, unknown>
const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

afterEach(() => {
  delete store[KEY]
  warn.mockClear()
  vi.resetModules()
})

it('stays quiet when the same copy loads again', async () => {
  await import('../src/instance-guard')
  vi.resetModules()
  await import('../src/instance-guard')
  expect(warn).not.toHaveBeenCalled()
})

it('warns when a second copy loads', async () => {
  store[KEY] = 'file:///elsewhere/node_modules/@forinda/kickjs-di/dist/index.mjs'
  await import('../src/instance-guard')
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('loaded twice'))
})
