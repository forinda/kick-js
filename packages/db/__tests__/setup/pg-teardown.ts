/**
 * Postgres tests stop their container after `pool.end()`. pg-pool resolves
 * `end()` before each client's socket has closed, so when Postgres terminates
 * those connections ("terminating connection due to administrator command",
 * 57P01) the error has nowhere to go — an uncaught exception that fails the
 * run however the tests did. It lands in one of two places:
 *
 * - the client, once pg-pool has detached its own listener — every client
 *   gets a listener of its own here;
 * - the pool, when the client was idle: pg-pool's idle listener re-emits it
 *   as the pool's 'error' (with `err.client` set) — every pool gets one too.
 *
 * Only asynchronous connection errors land on them: a failing query still
 * rejects that query's promise, so tests see real errors as before.
 */
import pg from 'pg'

const connect = pg.Client.prototype.connect
pg.Client.prototype.connect = function (this: pg.Client, ...args: unknown[]) {
  if (this.listenerCount('error') === 0) this.on('error', () => {})
  return (connect as (...a: unknown[]) => unknown).apply(this, args)
} as typeof connect

const poolConnect = pg.Pool.prototype.connect
pg.Pool.prototype.connect = function (this: pg.Pool, ...args: unknown[]) {
  if (this.listenerCount('error') === 0) this.on('error', () => {})
  return (poolConnect as (...a: unknown[]) => unknown).apply(this, args)
} as typeof poolConnect
