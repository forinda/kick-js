import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const reloadEnv = vi.fn()
vi.mock('@forinda/kickjs', () => ({ reloadEnv }))
const { envWatchPlugin, envFileCandidates } = await import('../src/env-watch-plugin')

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

  it('watches the files KICKJS_ENV_FILE names, and the mode files', () => {
    vi.stubEnv('KICKJS_ENV_FILE', 'config/.env.shared, /etc/app/.env')
    try {
      const root = '/app'
      const { server, handlers } = devServer(root)
      expect(server.watcher.add).toHaveBeenCalledWith(path.resolve(root, 'config/.env.shared'))
      expect(server.watcher.add).toHaveBeenCalledWith('/etc/app/.env')
      expect(server.watcher.add).not.toHaveBeenCalledWith(path.resolve(root, '.env'))
      reloadEnv.mockClear()
      handlers.change!('/etc/app/.env')
      handlers.change!(path.join(root, '.env')) // not loaded, so not a reload
      expect(reloadEnv).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('lists the files kickjs reads for a mode', () => {
    expect(envFileCandidates({ NODE_ENV: 'development' })).toEqual([
      '.env.development.local',
      '.env.development',
      '.env.local',
      '.env',
    ])
    expect(envFileCandidates({})).toContain('.env.development.local')
    expect(envFileCandidates({ KICKJS_ENV_FILE: 'off' })).toEqual([])
  })
})
