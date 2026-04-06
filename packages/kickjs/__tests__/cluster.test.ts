import 'reflect-metadata'
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import cluster from 'node:cluster'
import os from 'node:os'
import { Container } from '../src/index'

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Because the `cluster` module is a singleton with read-only properties
 * we mock the whole module for the primary-side tests.
 */

describe('Cluster module', () => {
  beforeEach(() => {
    Container.reset()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('isClusterPrimary()', () => {
    it('returns the value of cluster.isPrimary', async () => {
      const { isClusterPrimary } = await import('../src/http/cluster')
      // In the test runner this is always true (we are the primary process)
      expect(isClusterPrimary()).toBe(cluster.isPrimary)
    })
  })

  describe('setupClusterPrimary()', () => {
    it('forks the correct number of workers (explicit count)', async () => {
      const forkSpy = vi.spyOn(cluster, 'fork').mockReturnValue({
        process: { pid: 1234 },
      } as any)
      // Prevent actual signal handler registration from interfering
      const onSpy = vi.spyOn(cluster, 'on').mockImplementation(() => cluster)
      const processOnSpy = vi.spyOn(process, 'on').mockImplementation(() => process)

      const { setupClusterPrimary } = await import('../src/http/cluster')

      setupClusterPrimary({ workers: 3 })

      expect(forkSpy).toHaveBeenCalledTimes(3)

      forkSpy.mockRestore()
      onSpy.mockRestore()
      processOnSpy.mockRestore()
    })

    it('defaults to os.cpus().length workers when count is omitted', async () => {
      const cpuCount = os.cpus().length
      const forkSpy = vi.spyOn(cluster, 'fork').mockReturnValue({
        process: { pid: 1234 },
      } as any)
      const onSpy = vi.spyOn(cluster, 'on').mockImplementation(() => cluster)
      const processOnSpy = vi.spyOn(process, 'on').mockImplementation(() => process)

      const { setupClusterPrimary } = await import('../src/http/cluster')

      setupClusterPrimary({})

      expect(forkSpy).toHaveBeenCalledTimes(cpuCount)

      forkSpy.mockRestore()
      onSpy.mockRestore()
      processOnSpy.mockRestore()
    })

    it('registers a cluster exit handler for auto-restart', async () => {
      vi.spyOn(cluster, 'fork').mockReturnValue({ process: { pid: 1 } } as any)
      const onSpy = vi.spyOn(cluster, 'on').mockImplementation(() => cluster)
      vi.spyOn(process, 'on').mockImplementation(() => process)

      const { setupClusterPrimary } = await import('../src/http/cluster')

      setupClusterPrimary({ workers: 1 })

      // 'exit' handler should be registered on the cluster
      const exitCall = onSpy.mock.calls.find(([event]) => event === 'exit')
      expect(exitCall).toBeDefined()
      expect(typeof exitCall![1]).toBe('function')

      onSpy.mockRestore()
    })

    it('worker exit triggers a delayed fork (restart)', async () => {
      vi.useFakeTimers()

      const forkSpy = vi.spyOn(cluster, 'fork').mockReturnValue({
        process: { pid: 5678 },
      } as any)

      // Capture the exit callback
      let exitCallback: Function | undefined
      vi.spyOn(cluster, 'on').mockImplementation((event: string, cb: Function) => {
        if (event === 'exit') exitCallback = cb
        return cluster
      })
      vi.spyOn(process, 'on').mockImplementation(() => process)

      const { setupClusterPrimary } = await import('../src/http/cluster')

      setupClusterPrimary({ workers: 1 })

      // 1 fork from initial setup
      expect(forkSpy).toHaveBeenCalledTimes(1)

      // Simulate a worker dying
      exitCallback!({ process: { pid: 5678 } }, 1, null)

      // No immediate fork
      expect(forkSpy).toHaveBeenCalledTimes(1)

      // After the restart delay, a new fork should happen
      vi.advanceTimersByTime(1000)
      expect(forkSpy).toHaveBeenCalledTimes(2)

      vi.useRealTimers()
      forkSpy.mockRestore()
    })

    it('SIGTERM on primary calls cluster.disconnect()', async () => {
      vi.spyOn(cluster, 'fork').mockReturnValue({ process: { pid: 1 } } as any)
      vi.spyOn(cluster, 'on').mockImplementation(() => cluster)
      const disconnectSpy = vi.spyOn(cluster, 'disconnect').mockImplementation((cb?: () => void) => {
        cb?.()
      })
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      // Capture signal handlers registered by setupClusterPrimary
      const signalHandlers: Record<string | symbol, Function> = {}
      vi.spyOn(process, 'on').mockImplementation((event: string | symbol, handler: (...args: any[]) => void) => {
        signalHandlers[event as string] = handler
        return process
      })

      const { setupClusterPrimary } = await import('../src/http/cluster')

      setupClusterPrimary({ workers: 1 })

      // Fire the SIGTERM handler that was registered
      expect(signalHandlers['SIGTERM']).toBeDefined()
      signalHandlers['SIGTERM']()

      expect(disconnectSpy).toHaveBeenCalled()
      expect(exitSpy).toHaveBeenCalledWith(0)

      disconnectSpy.mockRestore()
      exitSpy.mockRestore()
    })
  })

  describe('bootstrap() cluster integration', () => {
    it('primary returns Application without starting the server', async () => {
      // Mock cluster.isPrimary = true and fork to prevent actual forks
      const originalIsPrimary = cluster.isPrimary
      Object.defineProperty(cluster, 'isPrimary', { value: true, configurable: true })

      const forkSpy = vi.spyOn(cluster, 'fork').mockReturnValue({
        process: { pid: 9999 },
      } as any)
      vi.spyOn(cluster, 'on').mockImplementation(() => cluster)
      vi.spyOn(process, 'on').mockImplementation(() => process)

      const { bootstrap } = await import('../src/http/bootstrap')

      const app = await bootstrap({
        modules: [],
        cluster: { workers: 2 },
      })

      // Primary should fork workers
      expect(forkSpy).toHaveBeenCalledTimes(2)

      // Primary should return an Application instance but NOT start a server
      expect(app).toBeDefined()
      expect(app.getHttpServer()).toBeNull()

      Object.defineProperty(cluster, 'isPrimary', {
        value: originalIsPrimary,
        configurable: true,
      })
      forkSpy.mockRestore()
    })

    it('cluster: true defaults worker count to CPU count', async () => {
      const originalIsPrimary = cluster.isPrimary
      Object.defineProperty(cluster, 'isPrimary', { value: true, configurable: true })

      const cpuCount = os.cpus().length
      const forkSpy = vi.spyOn(cluster, 'fork').mockReturnValue({
        process: { pid: 9999 },
      } as any)
      vi.spyOn(cluster, 'on').mockImplementation(() => cluster)
      vi.spyOn(process, 'on').mockImplementation(() => process)

      const { bootstrap } = await import('../src/http/bootstrap')

      await bootstrap({
        modules: [],
        cluster: true,
      })

      expect(forkSpy).toHaveBeenCalledTimes(cpuCount)

      Object.defineProperty(cluster, 'isPrimary', {
        value: originalIsPrimary,
        configurable: true,
      })
      forkSpy.mockRestore()
    })
  })
})
