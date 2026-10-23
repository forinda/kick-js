/**
 * Build a route's URL from its name — `'UsersController.show'` — instead of
 * spelling the path where you link to it, so a moved route can't leave a
 * redirect, a `Location` header or an email link pointing at the old one.
 *
 * @module @forinda/kickjs/http/url-for
 */

import { createToken } from '../core/token'

/**
 * Route names `kick typegen` knows: `'Controller.method'` → the route's
 * shape. Falls back to `string` before typegen has run.
 */
export type RouteName = [keyof KickRoutes.Named] extends [never]
  ? string
  : Extract<keyof KickRoutes.Named, string>

type ParamsOf<N> = N extends keyof KickRoutes.Named
  ? KickRoutes.Named[N] extends { params: infer P }
    ? P
    : Record<string, string | number>
  : Record<string, string | number>

/** Path params in the order the path has them: `['42', 'a']` for `/users/:id/posts/:slug`. */
export type PositionalParams = ReadonlyArray<string | number>

/** `params` is optional when the route has none, required otherwise. */
export type UrlForArgs<N> =
  Record<string, never> extends ParamsOf<N>
    ? [params?: ParamsOf<N> | PositionalParams, query?: UrlQuery]
    : [params: ParamsOf<N> | PositionalParams, query?: UrlQuery]

export type UrlQuery = Record<string, string | number | boolean | Array<string | number>>

/** Builds route URLs by name — what `ROUTE_URLS` resolves to. */
export interface UrlBuilder {
  /**
   * The URL of a route, by name — `'Controller.method'` — with its `:params`
   * filled (encoded) and an optional query string.
   */
  urlFor<N extends RouteName>(name: N, ...args: UrlForArgs<N>): string
}

/**
 * The app's {@link UrlBuilder}, for code outside a request — a job, a mailer,
 * a service building a link:
 *
 * ```ts
 * @Service()
 * class Mailer {
 *   constructor(@Inject(ROUTE_URLS) private readonly urls: UrlBuilder) {}
 *   resetLink(token: string) {
 *     return `https://example.com${this.urls.urlFor('AuthController.reset', { token })}`
 *   }
 * }
 * ```
 */
export const ROUTE_URLS = createToken<UrlBuilder>('kick/Http/routeUrls')
// One per process, like every DI binding: the container is process-wide, so
// with two apps in one process this is the one set up last. `ctx.urlFor()`
// always uses the app that is serving the request.

/** One app's route name → full path pattern (`/api/v1/users/:id`). */
export class RouteUrls implements UrlBuilder {
  private readonly paths = new Map<string, string>()

  /** First registration wins — a controller mounted twice keeps its first path. */
  add(name: string, path: string): void {
    if (!this.paths.has(name)) this.paths.set(name, path)
  }

  urlFor<N extends RouteName>(name: N, ...args: UrlForArgs<N>): string {
    const [params, query] = args
    return this.build(name, params as Record<string, unknown> | PositionalParams | undefined, query)
  }

  build(
    name: string,
    params?: Record<string, unknown> | PositionalParams,
    query?: UrlQuery,
  ): string {
    const pattern = this.paths.get(name)
    if (pattern === undefined) {
      throw new Error(`urlFor: no route named '${name}' — expected 'Controller.method'`)
    }
    if (Array.isArray(params)) {
      const list = params as PositionalParams
      // Positional (templates can't write objects): in the order the path has them.
      const keys = [...pattern.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]!)
      if (list.length !== keys.length) {
        throw new Error(
          `urlFor('${name}'): takes ${keys.length} param${keys.length === 1 ? '' : 's'}${keys.length ? ` (${keys.join(', ')})` : ''}, got ${list.length}`,
        )
      }
    }
    // A list fills each placeholder by position, so a repeated name keeps both values.
    let at = 0
    const path = pattern.replace(/:([A-Za-z0-9_]+)/g, (_, key: string) => {
      const value = Array.isArray(params)
        ? (params as PositionalParams)[at++]
        : (params as Record<string, unknown> | undefined)?.[key]
      if (value === undefined || value === null || value === '') {
        throw new Error(`urlFor('${name}'): missing param '${key}' for '${pattern}'`)
      }
      return encodeURIComponent(String(value))
    })
    if (!query) return path
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
      for (const v of Array.isArray(value) ? value : [value]) search.append(key, String(v))
    }
    const qs = search.toString()
    return qs ? `${path}?${qs}` : path
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace KickRoutes {
    /** `'Controller.method'` → route shape, written by `kick typegen`. */
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface Named {}
  }
}
