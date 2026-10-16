/**
 * Whether the process should behave as production — true unless `NODE_ENV`
 * is exactly `development` or `test`. Fails closed: an unset (or any other)
 * `NODE_ENV` counts as production, so a deploy that forgets to set it still
 * gets secure cookies, opaque 500s and no dev-only aids.
 *
 * Read per call, not at module scope — tests and late config may set
 * `NODE_ENV` after import — and guarded, since edge runtimes may not expose
 * `process`. Reads `process.env` rather than `getEnv()`: the framework must
 * not depend on the app's env schema (or on zod) to decide this.
 */
export function isProduction(): boolean {
  const env = typeof process !== 'undefined' ? process.env?.NODE_ENV : undefined
  return env !== 'development' && env !== 'test'
}
