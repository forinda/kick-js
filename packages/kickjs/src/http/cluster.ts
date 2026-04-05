import cluster from 'node:cluster'
import os from 'node:os'
import { createLogger } from '../core'

const log = createLogger('Cluster')

export interface ClusterOptions {
  /** Number of worker processes (default: os.cpus().length) */
  workers?: number
}

/** Returns true if the current process is the cluster primary */
export function isClusterPrimary(): boolean {
  return cluster.isPrimary
}

/** Delay between worker restarts to avoid crash loops (ms) */
const RESTART_DELAY = 1000

/**
 * Fork worker processes and manage the cluster lifecycle.
 *
 * The primary process forks `workers` child processes.  Each worker
 * shares the same port via Node's built-in `cluster` module (OS
 * round-robin load balancing).
 *
 * - Dead workers are automatically restarted after a short delay.
 * - SIGTERM/SIGINT on the primary is forwarded to all workers.
 */
export function setupClusterPrimary(opts: ClusterOptions): void {
  const numWorkers = opts.workers ?? os.cpus().length

  log.info(`Primary ${process.pid} starting ${numWorkers} worker(s)`)

  for (let i = 0; i < numWorkers; i++) {
    cluster.fork()
  }

  // Auto-restart dead workers
  cluster.on('exit', (worker, code, signal) => {
    log.warn(
      `Worker ${worker.process.pid} died (code=${code}, signal=${signal}), restarting in ${RESTART_DELAY}ms...`,
    )
    setTimeout(() => {
      cluster.fork()
    }, RESTART_DELAY)
  })

  // Forward shutdown signals to all workers
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      log.info(`Primary received ${signal}, forwarding to workers...`)
      for (const id in cluster.workers) {
        const worker = cluster.workers[id]
        if (worker) {
          worker.process.kill(signal)
        }
      }
    })
  }
}
