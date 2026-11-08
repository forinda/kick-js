import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const reloadEnv = vi.fn()
vi.mock('@forinda/kickjs', () => ({ reloadEnv }))
const { envWatchPlugin } = await import('../src/env-watch-plugin')

function devServer(root: string) {
  const handlers: Record<string, (file: string) => void> = {}
  const server = {
    config: { root, logger: { info: vi.fn(), warn: vi.fn() } },
    watcher: {
      add: vi.fn(),
      on: vi.fn((event: string, fn: (file: string) => void) => void (handlers[event] = fn)),
    },
    moduleGraph: { getModulesByFile: vi.fn(() => undefined), invalidateModule: vi.fn() },
    ws: { send: vi.fn() },
  }
  ;(envWatchPlugin() as { configureServer: (s: unknown) => void }).configureServer(server)
  return { server, handlers }
}

describe('envWatchPlugin', () => {
  it('watches every env file, existing or not, and reloads on create, change and delete', () => {
    const root = '/app-that-has-no-env-files'
    const { server, handlers } = devServer(root)
    expect(server.watcher.add).toHaveBeenCalledWith(path.resolve(root, '.env'))
    expect(server.watcher.add).toHaveBeenCalledWith(path.resolve(root, '.env.local'))
    for (const event of ['add', 'change', 'unlink']) handlers[event]!(path.join(root, '.env'))
    expect(reloadEnv).toHaveBeenCalledTimes(3)
    expect(server.ws.send).toHaveBeenCalledTimes(3)
    handlers.change!(path.join(root, 'src/app.ts'))
    expect(server.ws.send).toHaveBeenCalledTimes(3)
  })
})
