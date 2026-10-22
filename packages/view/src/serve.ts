/**
 * Serving component scripts: `<clientScriptPath>/<tag>.<hash>.js`. `KickView`
 * answers them on Express, Fastify and h3; on the web fetch entry, whose
 * middlewares only run for matched routes, call `clientScriptResponse` ahead
 * of the router.
 */
import { CLIENT_SCRIPT_FILE } from './client-scripts'
import type { Views } from './views'

/** A script's name never changes with its content, so it caches forever. */
export const CLIENT_SCRIPT_HEADERS: Record<string, string> = {
  'content-type': 'text/javascript; charset=utf-8',
  'cache-control': 'public, max-age=31536000, immutable',
}

/** The script file a GET / HEAD asks for under `views.clientScriptPath`, if any. */
export function clientScriptFile(
  views: Views,
  method: string | undefined,
  url: string,
): string | undefined {
  const m = String(method ?? 'GET').toUpperCase()
  if (m !== 'GET' && m !== 'HEAD') return undefined
  const path = url.split('?')[0]!
  const prefix = `${views.clientScriptPath}/`
  if (!path.startsWith(prefix)) return undefined
  const file = path.slice(prefix.length)
  return CLIENT_SCRIPT_FILE.test(file) ? file : undefined
}

/**
 * A component script's response, or `undefined` for anything else:
 *
 * ```ts
 * export default { fetch: async (req) => (await clientScriptResponse(views, req)) ?? web.fetch(req) }
 * ```
 */
export async function clientScriptResponse(
  views: Views,
  request: Request,
): Promise<Response | undefined> {
  const file = clientScriptFile(views, request.method, new URL(request.url).pathname)
  if (!file) return undefined
  const js = await views.clientScript(file)
  if (js === undefined) return undefined
  return new Response(request.method === 'HEAD' ? null : js, {
    status: 200,
    headers: CLIENT_SCRIPT_HEADERS,
  })
}
