/**
 * Devtools-endpoint fetch helper.
 *
 * Returns `null` on any failure (network error, non-2xx, parse
 * failure). Callers that need to differentiate between
 * "server-down" and "server-up-but-no-devtools" should use
 * `probeConnection` from `./connection` instead — this helper is
 * intentionally lossy because the tree providers only need
 * "do I have data or not?".
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchDebugData(baseUrl: string, path: string): Promise<any> {
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}
