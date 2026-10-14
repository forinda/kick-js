/**
 * Whether the process runs with `NODE_ENV=production`.
 *
 * Read per call, not at module scope — tests and late config may set
 * `NODE_ENV` after import — and guarded, since edge runtimes may not expose
 * `process`. Reads `process.env` rather than `getEnv()`: the framework must
 * not depend on the app's env schema (or on zod) to decide this.
 */
export function isProduction(): boolean {
  return typeof process !== 'undefined' && process.env?.NODE_ENV === 'production'
}
