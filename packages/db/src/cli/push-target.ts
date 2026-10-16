/**
 * The host a connection string points at, when it is not this machine or a
 * neighbouring container — or `undefined` for a local target or one push
 * can't see (a `db.adapter()` factory with no connection string). `kick db
 * push` asks before changing a remote database.
 */
export function remoteHost(connectionString: string | undefined): string | undefined {
  if (!connectionString) return undefined
  let host: string
  try {
    host = new URL(connectionString).hostname.replace(/^\[|\]$/g, '').toLowerCase()
  } catch {
    return undefined // not a URL (a key=value DSN, a file path): don't guess
  }
  if (!host) return undefined // a Unix socket or a file URL
  const local =
    host === 'localhost' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host.startsWith('127.') ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    !host.includes('.') // a compose service name: `db`, `postgres`
  return local ? undefined : host
}
