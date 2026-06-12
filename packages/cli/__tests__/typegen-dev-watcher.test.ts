import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { createTypegenDevWatcher, type TypegenDevPipeline } from '../src/typegen/dev-watcher'
import type { KickConfig } from '../src/config'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

function makePipeline() {
  return {
    runTypegen: vi.fn(async () => []),
    runAllPluginTypegens: vi.fn(async () => []),
    writeTypegenArtifacts: vi.fn(async () => []),
    buildAssets: vi.fn(async () => undefined),
  } as unknown as TypegenDevPipeline & {
    runTypegen: ReturnType<typeof vi.fn>
    runAllPluginTypegens: ReturnType<typeof vi.fn>
    buildAssets: ReturnType<typeof vi.fn>
  }
}

function makeWatcher(config: KickConfig | null = null, pipeline = makePipeline()) {
  const emitWarning = vi.fn()
  const onPassComplete = vi.fn()
  const watcher = createTypegenDevWatcher({
    cwd: '/proj',
    config,
    emitWarning,
    onPassComplete,
    pipeline,
  })
  return { watcher, pipeline, emitWarning, onPassComplete }
}

describe('createTypegenDevWatcher', () => {
  it('batches events in one debounce window into a single precise delta', async () => {
    const { watcher, pipeline } = makeWatcher()
    watcher.handleWatchEvent('change', '/proj/src/a.controller.ts')
    watcher.handleWatchEvent('add', '/proj/src/b.service.ts')
    watcher.handleWatchEvent('unlink', '/proj/src/gone.ts')
    await vi.advanceTimersByTimeAsync(150)

    expect(pipeline.runTypegen).toHaveBeenCalledTimes(1)
    const delta = pipeline.runTypegen.mock.calls[0][0].changedFiles
    expect(delta.changed.toSorted()).toEqual([
      '/proj/src/a.controller.ts',
      '/proj/src/b.service.ts',
    ])
    expect(delta.removed).toEqual(['/proj/src/gone.ts'])
    expect(pipeline.runAllPluginTypegens).toHaveBeenCalledTimes(1)
  })

  it('unlink supersedes a pending change for the same file (and vice versa)', async () => {
    const { watcher, pipeline } = makeWatcher()
    watcher.handleWatchEvent('change', '/proj/src/x.ts')
    watcher.handleWatchEvent('unlink', '/proj/src/x.ts')
    await vi.advanceTimersByTimeAsync(150)
    const delta = pipeline.runTypegen.mock.calls[0][0].changedFiles
    expect(delta.changed).toEqual([])
    expect(delta.removed).toEqual(['/proj/src/x.ts'])
  })

  it('unlinkDir forces a full scan (undefined delta)', async () => {
    const { watcher, pipeline } = makeWatcher()
    watcher.handleWatchEvent('change', '/proj/src/a.ts')
    watcher.handleWatchEvent('unlinkDir', '/proj/src/modules/old')
    await vi.advanceTimersByTimeAsync(150)
    expect(pipeline.runTypegen.mock.calls[0][0].changedFiles).toBeUndefined()
  })

  it('ignores .kickjs output and .d.ts files', async () => {
    const { watcher, pipeline } = makeWatcher()
    watcher.handleWatchEvent('change', '/proj/.kickjs/types/kick__routes.ts')
    watcher.handleWatchEvent('change', '/proj/src/generated.d.ts')
    await vi.advanceTimersByTimeAsync(150)
    expect(pipeline.runTypegen).not.toHaveBeenCalled()
  })

  it('asset changes trigger buildAssets only when an assetMap is configured', async () => {
    const config = { assetMap: { mails: { src: 'src/templates/mails' } } } as unknown as KickConfig
    const { watcher, pipeline } = makeWatcher(config)
    expect(watcher.assetSrcRoots.length).toBe(1)
    watcher.handleWatchEvent('change', `${watcher.assetSrcRoots[0]}/welcome.ejs`)
    await vi.advanceTimersByTimeAsync(150)
    expect(pipeline.buildAssets).toHaveBeenCalledTimes(1)
    // Asset-only window — the scan delta carries no .ts files.
    expect(pipeline.runTypegen.mock.calls[0][0].changedFiles).toEqual({
      changed: [],
      removed: [],
    })
  })

  it('asset detection survives mixed path separators (Windows chokidar)', async () => {
    const config = { assetMap: { mails: { src: 'src/templates/mails' } } } as unknown as KickConfig
    const { watcher, pipeline } = makeWatcher(config)
    // Simulate a native-separator chokidar event against the resolved root.
    const winStyle = `${watcher.assetSrcRoots[0].replaceAll('/', '\\')}\\welcome.ejs`
    watcher.handleWatchEvent('change', winStyle)
    await vi.advanceTimersByTimeAsync(150)
    expect(pipeline.buildAssets).toHaveBeenCalledTimes(1)
  })

  it('does not filter files merely named like .kickjs', async () => {
    const { watcher, pipeline } = makeWatcher()
    watcher.handleWatchEvent('change', '/proj/src/my.kickjs.backup.ts')
    await vi.advanceTimersByTimeAsync(150)
    expect(pipeline.runTypegen).toHaveBeenCalledTimes(1)
  })

  it('reports failures once and re-arms after success', async () => {
    const pipeline = makePipeline()
    pipeline.runTypegen
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue([])
    const { watcher, emitWarning } = makeWatcher(null, pipeline)

    watcher.handleWatchEvent('change', '/proj/src/a.ts')
    await vi.advanceTimersByTimeAsync(150)
    watcher.handleWatchEvent('change', '/proj/src/a.ts')
    await vi.advanceTimersByTimeAsync(150)
    expect(emitWarning).toHaveBeenCalledTimes(1) // identical failure deduped

    watcher.handleWatchEvent('change', '/proj/src/a.ts') // success → clears
    await vi.advanceTimersByTimeAsync(150)
    pipeline.runTypegen.mockRejectedValueOnce(new Error('boom'))
    watcher.handleWatchEvent('change', '/proj/src/a.ts')
    await vi.advanceTimersByTimeAsync(150)
    expect(emitWarning).toHaveBeenCalledTimes(2) // re-armed
  })

  it('runs onPassComplete after the plugin chain settles', async () => {
    const { watcher, onPassComplete } = makeWatcher()
    watcher.handleWatchEvent('change', '/proj/src/a.ts')
    await vi.advanceTimersByTimeAsync(150)
    expect(onPassComplete).toHaveBeenCalledTimes(1)
  })

  it('runOnce fires an immediate full pass', async () => {
    const { watcher, pipeline } = makeWatcher()
    watcher.runOnce()
    await vi.advanceTimersByTimeAsync(0)
    expect(pipeline.runTypegen).toHaveBeenCalledTimes(1)
    expect(pipeline.runTypegen.mock.calls[0][0].changedFiles).toBeUndefined()
  })

  it('dispose cancels the pending window and blocks further work', async () => {
    const { watcher, pipeline } = makeWatcher()
    watcher.handleWatchEvent('change', '/proj/src/a.ts')
    watcher.dispose()
    await vi.advanceTimersByTimeAsync(300)
    watcher.runOnce()
    expect(pipeline.runTypegen).not.toHaveBeenCalled()
  })
})
