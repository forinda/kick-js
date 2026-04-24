/**
 * Devtools-endpoint fetch helper.
 *
 * Returns `null` on any failure (network error, non-2xx, parse
 * failure). Callers that need to differentiate between
 * "server-down" and "server-up-but-no-devtools" should use
 * `probeConnection` from `./connection` instead — this helper is
 * intentionally lossy because the tree providers only need
 * "do I have data or not?".
 *
 * The optional `token` argument sends `x-devtools-token` so the
 * helper works against KickJS apps that mounted the devtools
 * adapter with `requireToken: true`. Empty/undefined token is the
 * common case (devtools adapter defaults to no-token), so callers
 * can pass it unconditionally without per-call branching.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchDebugData(baseUrl: string, path: string, token?: string): Promise<any> {
  try {
    const headers: Record<string, string> = {}
    if (token) headers['x-devtools-token'] = token
    const res = await fetch(`${baseUrl}${path}`, {
      signal: AbortSignal.timeout(5000),
      headers,
    })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}
