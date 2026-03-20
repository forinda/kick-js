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
