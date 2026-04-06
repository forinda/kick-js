import cluster from 'node:cluster'
import os from 'node:os'
import { createLogger } from '../core'
import { reactive, ref } from '../core/reactivity'

const log = createLogger('Cluster')

export interface ClusterOptions {
  /** Number of worker processes (default: os.cpus().length) */
  workers?: number
  /** Delay before forcefully killing a worker during shutdown (ms), default: 5000 */
  gracefulShutdownTimeout?: number
  /** Delay between worker restarts (ms), default: 1000 */
  restartDelay?: number
  /** Max failures in restartWindow before refusing to restart, default: 5 */
  maxFailures?: number
  /** Time window for counting failures (ms), default: 30000 */
  restartWindow?: number
}

/** Returns true if the current process is the cluster primary */
export function isClusterPrimary(): boolean {
  return cluster.isPrimary
}

/**
 * Fork worker processes and manage the cluster lifecycle.
 *
 * The primary process forks `workers` child processes. Each worker
 * shares the same port via Node's built-in `cluster` module (OS
 * round-robin load balancing).
 *
 * Features:
 * - Graceful shutdown with timeout fallback to forceful kill
 * - Auto-restart dead workers (respects voluntary disconnects)
 * - Startup timeout detection (stuck workers)
 * - Crash loop prevention (backoff on rapid failures)
 * - Comprehensive lifecycle logging
 */
export function setupClusterPrimary(opts: ClusterOptions): void {
  const numWorkers = opts.workers ?? os.cpus().length
  const gracefulTimeout = opts.gracefulShutdownTimeout ?? 5000
  const restartDelay = opts.restartDelay ?? 1000
  const maxFailures = opts.maxFailures ?? 5
  const restartWindow = opts.restartWindow ?? 30000

  const startupTimeouts = new Map<number, NodeJS.Timeout>()
  const state = reactive({
    failureTimestamps: [] as number[],
    shuttingDown: false,
  })
  const activeWorkers = ref(0)

  log.info(`Primary ${process.pid} starting ${numWorkers} worker(s)`)

  // Initial fork
  for (let i = 0; i < numWorkers; i++) {
    cluster.fork()
  }

  // Detect stuck workers (no 'listening' event within timeout)
  cluster.on('fork', (worker) => {
    const timeout = setTimeout(() => {
      log.error(`Worker ${worker.process.pid} did not respond within 10s, killing...`)
      worker.kill()
    }, 10000)

    startupTimeouts.set(worker.id, timeout)
    activeWorkers.value++
    log.debug(`Worker ${worker.process.pid} forked (id=${worker.id})`)
  })

  // Clear startup timeout when worker is ready
  cluster.on('listening', (worker, address) => {
    const timeout = startupTimeouts.get(worker.id)
    if (timeout) {
      clearTimeout(timeout)
      startupTimeouts.delete(worker.id)
    }
    log.info(`Worker ${worker.process.pid} listening on ${address.address}:${address.port}`)
  })

  // Log when worker comes online
  cluster.on('online', (worker) => {
    log.debug(`Worker ${worker.process.pid} online (id=${worker.id})`)
  })

  // Auto-restart dead workers (unless intentionally disconnected)
  cluster.on('exit', (worker, code, signal) => {
    // Clear startup timeout if still pending
    const timeout = startupTimeouts.get(worker.id)
    if (timeout) {
      clearTimeout(timeout)
      startupTimeouts.delete(worker.id)
    }

    // Don't restart if worker was intentionally disconnected
    activeWorkers.value--

    if (worker.exitedAfterDisconnect) {
      log.info(`Worker ${worker.process.pid} exited gracefully (id=${worker.id})`)
      return
    }

    // Track crash history globally (worker IDs change on restart)
    const now = Date.now()
    // Remove timestamps outside the window, then add the current failure
    while (
      state.failureTimestamps.length > 0 &&
      now - state.failureTimestamps[0] >= restartWindow
    ) {
      state.failureTimestamps.shift()
    }
    state.failureTimestamps.push(now)

    // Prevent restart loops
    if (state.failureTimestamps.length > maxFailures) {
      log.error(
        `${state.failureTimestamps.length} worker failures in ${restartWindow}ms, giving up`,
      )
      // Optionally exit the primary if too many workers are crashing
      if (activeWorkers.value === 0) {
        log.error('All workers have crashed, exiting primary')
        process.exit(1)
      }
      return
    }

    log.warn(
      `Worker ${worker.process.pid} died (code=${code}, signal=${signal}), restarting in ${restartDelay}ms... (failures: ${state.failureTimestamps.length}/${maxFailures})`,
    )

    setTimeout(() => {
      // Only restart if we still need more workers
      if (activeWorkers.value < numWorkers) {
        cluster.fork()
      }
    }, restartDelay)
  })

  // Log when worker disconnects (can happen before exit)
  cluster.on('disconnect', (worker) => {
    log.debug(`Worker ${worker.process.pid} disconnected (id=${worker.id})`)
  })

  // Forward shutdown signals to workers (disconnect so exitedAfterDisconnect is set)
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      if (state.shuttingDown) return
      state.shuttingDown = true
      log.info(`Primary received ${signal}, disconnecting workers...`)
      cluster.disconnect(() => {
        log.info('All workers disconnected, exiting primary')
        process.exit(0)
      })
      // Force kill after graceful timeout
      setTimeout(() => {
        log.warn('Graceful shutdown timed out, forcing exit')
        process.exit(1)
      }, gracefulTimeout).unref()
    })
  }
}
