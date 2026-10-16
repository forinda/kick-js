/**
 * The host a connection string points at, when it is not this machine or a
 * neighbouring container — or `undefined` for a local target or one push
 * can't see (a `db.adapter()` factory with no connection string). `kick db
 * push` asks before changing a remote database.
 */
export function remoteHost(connectionString: string | undefined): string | undefined {
  // Parsed by hand: a libpq host list (`h1:5432,h2:5433`) isn't a valid WHATWG
  // URL, and that's exactly a case to catch.
  const match = /^[a-z][\w+.-]*:\/\/(?:[^@/?#]*@)?([^/?#]*)[^?#]*(?:\?([^#]*))?/i.exec(
    connectionString ?? '',
  )
  if (!match) return undefined // not a URL (a key=value DSN, a file path): don't guess
  // Postgres takes `?host=` over the URL's own host, and a URL may list several
  // hosts. Check every host the driver may connect to.
  const hostParam = new URLSearchParams(match[2] ?? '').get('host')
  const hosts = (hostParam ?? decodeURIComponent(match[1] ?? ''))
    .split(',')
    .map((h) => stripPort(h.trim()).toLowerCase())
    .filter((h) => h && !h.startsWith('/')) // empty, or a Unix socket directory
  return hosts.find((host) => !isLocal(host))
}

/** `[::1]:5432` → `::1`, `db:5432` → `db`, `db` → `db`. */
function stripPort(entry: string): string {
  if (entry.startsWith('[')) return entry.slice(1, entry.indexOf(']'))
  return entry.replace(/:\d+$/, '')
}

function isLocal(host: string): boolean {
  return (
    host === 'localhost' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host.startsWith('127.') ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    !host.includes('.') // a compose service name: `db`, `postgres`
  )
}
