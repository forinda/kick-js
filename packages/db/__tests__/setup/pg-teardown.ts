/**
 * Postgres tests stop their container after `pool.end()`. pg-pool resolves
 * `end()` before each client's socket has closed, and detaches its own error
 * listener first, so when Postgres terminates those connections
 * ("terminating connection due to administrator command", 57P01) the client
 * emits 'error' with no one listening — an uncaught exception that fails the
 * run however the tests did. Every client gets a listener of its own here.
 *
 * Only asynchronous connection errors land on it: a failing query still
 * rejects that query's promise, so tests see real errors as before.
 */
import pg from 'pg'

const connect = pg.Client.prototype.connect
pg.Client.prototype.connect = function (this: pg.Client, ...args: unknown[]) {
  if (this.listenerCount('error') === 0) this.on('error', () => {})
  return (connect as (...a: unknown[]) => unknown).apply(this, args)
} as typeof connect
