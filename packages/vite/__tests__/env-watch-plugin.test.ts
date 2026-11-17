import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const reloadEnv = vi.fn()
vi.mock('@forinda/kickjs', () => ({ reloadEnv }))
const { envWatchPlugin, envFileCandidates } = await import('../src/env-watch-plugin')

function devServer(root: string, watch: { cwd?: string } = {}) {
  const handlers: Record<string, (file: string) => void> = {}
  const server = {
    config: { root, server: { watch }, logger: { info: vi.fn(), warn: vi.fn() } },
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
    const root = process.cwd() // where the loader reads them
    const { server, handlers } = devServer('/vite-root')
    expect(server.watcher.add).toHaveBeenCalledWith(path.resolve(root, '.env'))
    expect(server.watcher.add).toHaveBeenCalledWith(path.resolve(root, '.env.local'))
    for (const event of ['add', 'change', 'unlink']) handlers[event]!(path.join(root, '.env'))
    expect(reloadEnv).toHaveBeenCalledTimes(3)
    expect(server.ws.send).toHaveBeenCalledTimes(3)
    handlers.change!(path.join(root, 'src/app.ts'))
    expect(server.ws.send).toHaveBeenCalledTimes(3)
  })

  it('watches the files KICKJS_ENV_FILE names, and the mode files', () => {
    const outside = path.resolve('/etc/app/.env') // drive-qualified on Windows
    vi.stubEnv('KICKJS_ENV_FILE', `config/.env.shared, ${outside}`)
    try {
      const root = process.cwd()
      const { server, handlers } = devServer('/vite-root/client')
      expect(server.watcher.add).toHaveBeenCalledWith(path.resolve(root, 'config/.env.shared'))
      expect(server.watcher.add).toHaveBeenCalledWith(outside)
      expect(server.watcher.add).not.toHaveBeenCalledWith(path.resolve(root, '.env'))
      reloadEnv.mockClear()
      handlers.change!(outside)
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
    expect(envFileCandidates({ NODE_ENV: 'development', VITEST: 'true' })[0]).toBe(
      '.env.test.local',
    )
    expect(envFileCandidates({ KICKJS_ENV_FILE: 'off' })).toEqual([])
  })

  it("reads a change path relative to the watcher's cwd", () => {
    const { handlers } = devServer('/vite-root', { cwd: path.join(process.cwd(), 'client') })
    reloadEnv.mockClear()
    handlers.change!(path.join('..', '.env'))
    expect(reloadEnv).toHaveBeenCalledTimes(1)
  })
})
