/**
 * API runner — the framework-free half: turning a route plus the user's
 * inputs into a request, and a request into curl / fetch snippets.
 *
 * Kept free of Solid and the DOM (cookies and storage are passed in) so it
 * is unit-tested directly; `api-runner.tsx` is the UI over it.
 */

/** One key/value row in the query or headers editor. */
export interface KeyValueRow {
  key: string
  value: string
  enabled: boolean
}

/** What the user typed for one route. */
export interface RouteInputs {
  params: Record<string, string>
  query: KeyValueRow[]
  headers: KeyValueRow[]
  body: string
}

/** Runner settings — names an app can change from the framework defaults. */
export interface RunnerSettings {
  /**
   * Route flag(s) that mark a route public; the default Authorization header
   * is skipped on them. One name or several — apps name this flag themselves
   * (`auth.public`, `public`, …), and some use more than one.
   */
  publicFlag: string | string[]
  /** `csrf()` / `csrfGuard()` cookie name. */
  csrfCookie: string
  /** `csrf()` / `csrfGuard()` header name. */
  csrfHeader: string
}

export const DEFAULT_SETTINGS: RunnerSettings = {
  publicFlag: 'auth.public',
  csrfCookie: '_csrf',
  csrfHeader: 'x-csrf-token',
}

/** The route fields the runner needs (a subset of the store's RouteEntry). */
export interface RunnerRoute {
  method: string
  path: string
  flags?: Record<string, unknown>
}

/** A request ready to send or to render as a snippet. */
export interface PreparedRequest {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
}

/**
 * Normalise the public-flag setting to a list of names. Accepts one name, a
 * list, or a comma-separated string (how the settings field edits it).
 */
export function publicFlagNames(setting: string | string[]): string[] {
  const names = Array.isArray(setting) ? setting : setting.split(',')
  return names.map((name) => name.trim()).filter(Boolean)
}

/** Whether the route carries any of the configured public flags. */
export function isPublicRoute(route: RunnerRoute, settings: RunnerSettings): boolean {
  return publicFlagNames(settings.publicFlag).some((name) => route.flags?.[name] !== undefined)
}

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Methods that change data — the UI asks for a second click before sending. */
export const needsConfirmation = (method: string): boolean =>
  ['DELETE', 'PUT', 'PATCH'].includes(method.toUpperCase())

export const acceptsBody = (method: string): boolean => BODY_METHODS.has(method.toUpperCase())

/** `:name` segments in a route path, in order, without duplicates. */
export function pathParams(path: string): string[] {
  const names = [...path.matchAll(/:([A-Za-z_$][\w$]*)/g)].map((m) => m[1])
  return [...new Set(names)]
}

/**
 * Substitute path params and append enabled query rows. Paths from
 * `/_debug/routes` already carry the API prefix and version, so they are used
 * as-is. A param left empty stays as `:name`, so the mistake is visible.
 */
export function buildUrl(
  origin: string,
  path: string,
  params: Record<string, string>,
  query: KeyValueRow[],
): string {
  const resolved = path.replace(/:([A-Za-z_$][\w$]*)/g, (whole, name: string) =>
    params[name] ? encodeURIComponent(params[name]) : whole,
  )
  const search = new URLSearchParams()
  for (const row of query) if (row.enabled && row.key) search.append(row.key, row.value)
  const qs = search.toString()
  return `${origin}${resolved}${qs ? `?${qs}` : ''}`
}

/** Read one cookie from a `document.cookie`-style string. */
export function readCookie(cookieHeader: string, name: string): string | undefined {
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return undefined
}

const VARIABLE = /\{\{\s*([\w.-]+)\s*\}\}/g

/**
 * Replace `{{name}}` with the variable's value. An unknown variable is left as
 * written, so a typo shows up in the request instead of becoming an empty string.
 */
export function interpolate(text: string, variables: Record<string, string>): string {
  return text.replace(VARIABLE, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(variables, name) ? variables[name] : whole,
  )
}

/** Enabled rows with a name, as a lookup table. */
export function variableMap(rows: KeyValueRow[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const row of rows) if (row.enabled && row.key) out[row.key] = row.value
  return out
}

/** `{{name}}` references that no variable resolves — shown as a hint in the UI. */
export function unresolvedVariables(req: PreparedRequest): string[] {
  const text = [req.url, ...Object.entries(req.headers).flat(), req.body ?? ''].join('\n')
  return [...new Set([...text.matchAll(VARIABLE)].map((m) => m[1]))]
}

/**
 * Read a value out of parsed JSON by a dotted path with optional indexes —
 * `accessToken`, `data.token`, `items[0].id`. Objects come back as JSON text;
 * a missing path returns `undefined`.
 */
export function readJsonPath(json: unknown, path: string): string | undefined {
  const keys = path.match(/[^.[\]]+/g) ?? []
  let current: unknown = json
  for (const key of keys) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  if (current === undefined) return undefined
  return typeof current === 'string' ? current : JSON.stringify(current)
}

/**
 * Assemble the request: default headers first, the route's own headers over
 * them, then what the framework needs. `{{name}}` in any value — params,
 * query, header names and values, body — is replaced from `variables`.
 *
 * - On a route carrying the public flag, a default `Authorization` is left out —
 *   the point of trying a public route is seeing it work without credentials.
 *   One set on the route itself is kept.
 * - Unsafe methods get the CSRF header from the CSRF cookie, when there is one.
 * - A JSON-looking body gets `Content-Type: application/json` unless set.
 */
export function prepareRequest(input: {
  route: RunnerRoute
  inputs: RouteInputs
  defaults: KeyValueRow[]
  settings: RunnerSettings
  origin: string
  cookies: string
  variables?: Record<string, string>
}): PreparedRequest {
  const { route, settings, origin, cookies } = input
  const vars = input.variables ?? {}
  const fill = (text: string) => interpolate(text, vars)
  const fillRows = (rows: KeyValueRow[]) =>
    rows.map((r) => ({ ...r, key: fill(r.key), value: fill(r.value) }))
  const inputs: RouteInputs = {
    params: Object.fromEntries(Object.entries(input.inputs.params).map(([k, v]) => [k, fill(v)])),
    query: fillRows(input.inputs.query),
    headers: fillRows(input.inputs.headers),
    body: fill(input.inputs.body),
  }
  const defaults = fillRows(input.defaults)
  const method = route.method.toUpperCase()
  const isPublic = isPublicRoute(route, settings)

  const headers: Record<string, string> = {}
  const set = (rows: KeyValueRow[], skipAuth: boolean) => {
    for (const row of rows) {
      if (!row.enabled || !row.key) continue
      if (skipAuth && row.key.toLowerCase() === 'authorization') continue
      // Header names are case-insensitive: a later row replaces an earlier one.
      for (const existing of Object.keys(headers)) {
        if (existing.toLowerCase() === row.key.toLowerCase()) delete headers[existing]
      }
      headers[row.key] = row.value
    }
  }
  set(defaults, isPublic)
  set(inputs.headers, false)

  const has = (name: string) => Object.keys(headers).some((k) => k.toLowerCase() === name)

  if (!SAFE_METHODS.has(method) && !has(settings.csrfHeader.toLowerCase())) {
    const token = readCookie(cookies, settings.csrfCookie)
    if (token) headers[settings.csrfHeader] = token
  }

  const body = acceptsBody(method) && inputs.body.trim() ? inputs.body : undefined
  if (body !== undefined && !has('content-type') && /^\s*[[{]/.test(body)) {
    headers['Content-Type'] = 'application/json'
  }

  return {
    method,
    url: buildUrl(origin, route.path, inputs.params, inputs.query),
    headers,
    ...(body !== undefined ? { body } : {}),
  }
}

/** Single-quote a string for POSIX shells. */
const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`

export function toCurl(req: PreparedRequest): string {
  const parts = [`curl -X ${req.method} ${shellQuote(req.url)}`]
  for (const [k, v] of Object.entries(req.headers)) parts.push(`-H ${shellQuote(`${k}: ${v}`)}`)
  if (req.body !== undefined) parts.push(`--data-raw ${shellQuote(req.body)}`)
  return parts.join(' \\\n  ')
}

export function toFetch(req: PreparedRequest): string {
  const init: Record<string, unknown> = { method: req.method }
  if (Object.keys(req.headers).length) init.headers = req.headers
  if (req.body !== undefined) init.body = req.body
  return `await fetch(${JSON.stringify(req.url)}, ${JSON.stringify(init, null, 2)})`
}

/** Pretty-print a JSON body; anything else is returned unchanged. */
export function formatBody(text: string, contentType: string | null): string {
  if (!contentType?.includes('json')) return text
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

/** Storage key for one route's saved inputs. */
export const inputsKey = (route: RunnerRoute): string =>
  `kickjs-devtools:runner:${route.method.toUpperCase()} ${route.path}`

export const emptyInputs = (route: RunnerRoute): RouteInputs => ({
  params: Object.fromEntries(pathParams(route.path).map((p) => [p, ''])),
  query: [],
  headers: [],
  body: '',
})
