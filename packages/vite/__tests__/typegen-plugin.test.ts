import { EventEmitter } from 'node:events'

import { describe, it, expect, vi, afterEach } from 'vitest'

import { kickjsTypegenPlugin, type TypegenCliModule } from '../src/typegen-plugin'

const OWNER_KEY = '__kickjs_typegen_owner'

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[OWNER_KEY]
})

function makeFakeServer() {
  const watcher = new EventEmitter() as EventEmitter & { add: ReturnType<typeof vi.fn> }
  watcher.add = vi.fn()
  const httpServer = new EventEmitter()
  return {
    config: {
      root: '/proj',
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    },
    watcher,
    hot: { send: vi.fn() },
    httpServer,
  }
}

function makeFakeCli() {
  const watcher = {
    handleWatchEvent: vi.fn(),
    runOnce: vi.fn(),
    assetSrcRoots: [] as string[],
    dispose: vi.fn(),
  }
  const cli: TypegenCliModule = {
    loadKickConfig: vi.fn(async () => ({})),
    createTypegenDevWatcher: vi.fn(() => watcher),
  }
  return { cli, watcher }
}

async function runConfigureServer(plugin: ReturnType<typeof kickjsTypegenPlugin>, server: unknown) {
  const hook = plugin.configureServer
  const fn = typeof hook === 'function' ? hook : hook!.handler
  await fn.call({} as never, server as never)
}

describe('kickjsTypegenPlugin', () => {
  it('stands down when kick dev owns typegen', async () => {
    ;(globalThis as Record<string, unknown>)[OWNER_KEY] = 'kick-dev'
    const { cli } = makeFakeCli()
    const server = makeFakeServer()
    await runConfigureServer(kickjsTypegenPlugin({ loadCli: async () => cli }), server)
    expect(cli.createTypegenDevWatcher).not.toHaveBeenCalled()
  })

  it('no-ops with a notice when the CLI is not resolvable', async () => {
    const server = makeFakeServer()
    await runConfigureServer(kickjsTypegenPlugin({ loadCli: async () => null }), server)
    expect(server.config.logger.info).toHaveBeenCalledTimes(1)
    expect(server.config.logger.info.mock.calls[0][0]).toContain('typegen-on-save disabled')
  })

  it('wires the watcher: startup pass, watch events, dispose on close', async () => {
    const { cli, watcher } = makeFakeCli()
    const server = makeFakeServer()
    await runConfigureServer(kickjsTypegenPlugin({ loadCli: async () => cli }), server)

    expect(watcher.runOnce).toHaveBeenCalledTimes(1)

    server.watcher.emit('change', '/proj/src/a.controller.ts')
    server.watcher.emit('add', '/proj/src/b.ts')
    server.watcher.emit('unlink', '/proj/src/c.ts')
    server.watcher.emit('unlinkDir', '/proj/src/old')
    expect(watcher.handleWatchEvent.mock.calls).toEqual([
      ['change', '/proj/src/a.controller.ts'],
      ['add', '/proj/src/b.ts'],
      ['unlink', '/proj/src/c.ts'],
      ['unlinkDir', '/proj/src/old'],
    ])

    server.httpServer.emit('close')
    expect(watcher.dispose).toHaveBeenCalledTimes(1)
  })

  it('broadcasts warnings on the kickjs:typegen-error channel', async () => {
    const { cli } = makeFakeCli()
    const server = makeFakeServer()
    await runConfigureServer(kickjsTypegenPlugin({ loadCli: async () => cli }), server)

    const opts = (cli.createTypegenDevWatcher as ReturnType<typeof vi.fn>).mock.calls[0][0]
    opts.emitWarning('types may be stale')
    expect(server.config.logger.warn).toHaveBeenCalledWith('types may be stale')
    expect(server.hot.send).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'kickjs:typegen-error' }),
    )
  })
})
