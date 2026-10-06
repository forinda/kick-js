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
/**
 * One multipart field. `file` rows carry the picked files in memory only —
 * `File` objects can't be saved, so they are dropped from stored inputs and
 * have to be picked again after a reload.
 */
export interface FormRow {
  key: string
  value: string
  enabled: boolean
  type: 'text' | 'file'
  files?: File[]
}

export type BodyMode = 'raw' | 'form'

export interface RouteInputs {
  params: Record<string, string>
  query: KeyValueRow[]
  headers: KeyValueRow[]
  body: string
  /** `raw` sends `body` as text; `form` sends `form` as multipart/form-data. */
  bodyMode?: BodyMode
  form?: FormRow[]
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
  /** Where the Swagger adapter serves the spec — prefills inputs when it answers. */
  openApiUrl: string
  /** "Open in editor" link; `{file}` (absolute) and `{line}` are filled in. */
  editorUrl: string
}

export const DEFAULT_SETTINGS: RunnerSettings = {
  publicFlag: 'auth.public',
  csrfCookie: '_csrf',
  csrfHeader: 'x-csrf-token',
  openApiUrl: '/openapi.json',
  editorUrl: 'vscode://file{file}:{line}',
}

/** The route fields the runner needs (a subset of the store's RouteEntry). */
export interface RunnerRoute {
  method: string
  path: string
  flags?: Record<string, unknown>
  /** From `@FileUpload` — the runner starts such routes in form mode with this field. */
  upload?: { mode: 'single' | 'array' | 'none'; fieldName?: string; maxCount?: number }
  /** The route's own request schemas (JSON Schema), sent by the DevTools adapter. */
  schemas?: {
    body?: Record<string, unknown>
    query?: Record<string, unknown>
    params?: Record<string, unknown>
  }
}

/** A request ready to send or to render as a snippet. */
/** One multipart part, as the snippets describe it. */
export interface FormPart {
  name: string
  value?: string
  fileName?: string
}

export interface PreparedRequest {
  method: string
  url: string
  headers: Record<string, string>
  /** Text body, or multipart form data (no Content-Type: the browser adds the boundary). */
  body?: string | FormData
  /** Present for multipart bodies — what `toCurl` / `toFetch` render. */
  form?: FormPart[]
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
 * The values a concrete path gives a route pattern's params —
 * `('/users/:id', '/users/42')` → `{ id: '42' }`. Empty when it doesn't match.
 */
export function paramsFromPath(pattern: string, path: string): Record<string, string> {
  const names: string[] = []
  const source = pattern
    .split(/(:[A-Za-z_$][\w$]*)/)
    .map((part) => {
      if (!part.startsWith(':')) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      names.push(part.slice(1))
      return '([^/]+)'
    })
    .join('')
  const match = new RegExp(`^${source}/?$`).exec(path)
  if (!match) return {}
  const decode = (v: string): string => {
    try {
      return decodeURIComponent(v)
    } catch {
      return v // a stray `%` — keep it as sent
    }
  }
  return Object.fromEntries(names.map((n, i) => [n, decode(match[i + 1]!)]))
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
  // A multipart body is a FormData — scan its described parts, not the object.
  const body = typeof req.body === 'string' ? req.body : ''
  const formText = (req.form ?? []).flatMap((part) => [part.name, part.value ?? ''])
  const text = [req.url, ...Object.entries(req.headers).flat(), body, ...formText].join('\n')
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
    bodyMode: input.inputs.bodyMode,
    // A copy, not an in-place edit: the rows are the UI's live state.
    // oxlint-disable-next-line no-map-spread
    form: (input.inputs.form ?? []).map((r) => ({ ...r, key: fill(r.key), value: fill(r.value) })),
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

  const url = buildUrl(origin, route.path, inputs.params, inputs.query)

  if (acceptsBody(method) && inputs.bodyMode === 'form') {
    const { body, form } = buildForm(inputs.form ?? [])
    // A Content-Type set here would lack the multipart boundary the browser
    // generates — drop any, so the request can be parsed.
    for (const name of Object.keys(headers)) {
      if (name.toLowerCase() === 'content-type') delete headers[name]
    }
    return { method, url, headers, body, form }
  }

  const body = acceptsBody(method) && inputs.body.trim() ? inputs.body : undefined
  if (body !== undefined && !has('content-type') && /^\s*[[{]/.test(body)) {
    headers['Content-Type'] = 'application/json'
  }

  return { method, url, headers, ...(body !== undefined ? { body } : {}) }
}

/** Build the multipart body from the enabled rows, plus the description the snippets use. */
function buildForm(rows: FormRow[]): { body: FormData; form: FormPart[] } {
  const body = new FormData()
  const form: FormPart[] = []
  for (const row of rows) {
    if (!row.enabled || !row.key) continue
    if (row.type === 'file') {
      for (const file of row.files ?? []) {
        body.append(row.key, file, file.name)
        form.push({ name: row.key, fileName: file.name })
      }
    } else {
      body.append(row.key, row.value)
      form.push({ name: row.key, value: row.value })
    }
  }
  return { body, form }
}

/** Single-quote a string for POSIX shells. */
const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`

export function toCurl(req: PreparedRequest): string {
  const parts = [`curl -X ${req.method} ${shellQuote(req.url)}`]
  for (const [k, v] of Object.entries(req.headers)) parts.push(`-H ${shellQuote(`${k}: ${v}`)}`)
  if (req.form) {
    // `-F name=@path` uploads a file; the path is the picked file's name, so
    // run it from the directory holding the file (or edit the path).
    for (const part of req.form) {
      parts.push(
        `-F ${shellQuote(part.fileName !== undefined ? `${part.name}=@${part.fileName}` : `${part.name}=${part.value ?? ''}`)}`,
      )
    }
  } else if (typeof req.body === 'string') {
    parts.push(`--data-raw ${shellQuote(req.body)}`)
  }
  return parts.join(' \\\n  ')
}

export function toFetch(req: PreparedRequest): string {
  const init: Record<string, unknown> = { method: req.method }
  if (Object.keys(req.headers).length) init.headers = req.headers
  if (req.form) {
    // Files can't be written into code: each one is read from a file input.
    const lines = ['const form = new FormData()']
    for (const part of req.form) {
      lines.push(
        part.fileName !== undefined
          ? `form.append(${JSON.stringify(part.name)}, fileInput.files[0]) // ${part.fileName}`
          : `form.append(${JSON.stringify(part.name)}, ${JSON.stringify(part.value ?? '')})`,
      )
    }
    const initText = JSON.stringify(init, null, 2).replace(/\n}$/, ',\n  "body": form\n}')
    return `${lines.join('\n')}\n\nawait fetch(${JSON.stringify(req.url)}, ${initText})`
  }
  if (typeof req.body === 'string') init.body = req.body
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

export const emptyInputs = (route: RunnerRoute): RouteInputs => {
  const upload = route.upload && route.upload.mode !== 'none' ? route.upload : undefined
  return {
    params: Object.fromEntries(pathParams(route.path).map((p) => [p, ''])),
    query: [],
    headers: [],
    body: '',
    // An @FileUpload route starts in form mode with its declared field.
    bodyMode: upload ? 'form' : 'raw',
    form: upload
      ? [{ key: upload.fieldName ?? 'file', value: '', enabled: true, type: 'file' }]
      : [],
  }
}

/** Inputs as they are saved: files are in-memory only, so they are dropped. */
export function storableInputs(inputs: RouteInputs): RouteInputs {
  return { ...inputs, form: inputs.form?.map(({ files: _files, ...row }) => row) }
}

// ── History ─────────────────────────────────────────────────────────────

/**
 * One sent request. Stores the inputs as typed — `{{variables}}` unresolved —
 * so the history never holds more than the saved inputs already do.
 */
export interface HistoryEntry {
  at: number
  method: string
  path: string
  inputs: RouteInputs
  status?: number
  ms?: number
  error?: string
}

export const HISTORY_LIMIT = 30

/** Newest first, capped. */
export function pushHistory(
  list: HistoryEntry[],
  entry: HistoryEntry,
  limit = HISTORY_LIMIT,
): HistoryEntry[] {
  return [{ ...entry, inputs: storableInputs(entry.inputs) }, ...list].slice(0, limit)
}

/** The request line a history row shows: path with params and query filled in, no origin. */
export const historyLabel = (entry: HistoryEntry): string =>
  buildUrl('', entry.path, entry.inputs.params, entry.inputs.query)

// ── OpenAPI ─────────────────────────────────────────────────────────────

/** What the spec says about one operation, reduced to what the runner fills in. */
export interface OpenApiHints {
  summary?: string
  params: Record<string, string>
  query: Array<{ name: string; required: boolean; description?: string }>
  /** Example JSON body, built from the request schema. */
  body?: string
}

type Json = Record<string, any>

/** The operation for this route: spec paths use `{id}`, routes use `:id`. */
function findOperation(spec: Json, route: RunnerRoute): Json | undefined {
  for (const [path, item] of Object.entries<Json>(spec?.paths ?? {})) {
    if (path.replace(/\{([^}]+)\}/g, ':$1') === route.path) {
      return item?.[route.method.toLowerCase()]
    }
  }
  return undefined
}

function deref(spec: Json, schema: Json | undefined): Json | undefined {
  const ref = schema?.$ref
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return schema
  let node: any = spec
  for (const key of ref.slice(2).split('/')) node = node?.[key]
  return node
}

/** A value shaped like the schema: its example or default when given, else a blank of its type. */
export function exampleFromSchema(spec: Json, input: Json | undefined, depth = 0): unknown {
  const schema = deref(spec, input)
  if (!schema || depth > 6) return null
  if (schema.example !== undefined) return schema.example
  if (schema.default !== undefined) return schema.default
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0]
  const variant = schema.oneOf?.[0] ?? schema.anyOf?.[0]
  if (variant) return exampleFromSchema(spec, variant, depth + 1)
  if (schema.allOf) {
    return Object.assign(
      {},
      ...schema.allOf.map((part: Json) => exampleFromSchema(spec, part, depth + 1)),
    )
  }
  const type = Array.isArray(schema.type)
    ? schema.type.find((t: string) => t !== 'null')
    : schema.type
  switch (type ?? (schema.properties ? 'object' : undefined)) {
    case 'object':
      return Object.fromEntries(
        Object.entries<Json>(schema.properties ?? {}).map(([key, prop]) => [
          key,
          exampleFromSchema(spec, prop, depth + 1),
        ]),
      )
    case 'array':
      return schema.items ? [exampleFromSchema(spec, schema.items, depth + 1)] : []
    case 'string':
      return ''
    case 'integer':
    case 'number':
      return 0
    case 'boolean':
      return false
    default:
      return null
  }
}

export function openApiHints(spec: unknown, route: RunnerRoute): OpenApiHints | undefined {
  const op = findOperation(spec as Json, route)
  if (!op) return undefined
  const params: Record<string, string> = {}
  const query: OpenApiHints['query'] = []
  for (const raw of op.parameters ?? []) {
    const p = deref(spec as Json, raw)
    if (!p?.name) continue
    if (p.in === 'path' && p.description) params[p.name] = p.description
    if (p.in === 'query') {
      query.push({ name: p.name, required: Boolean(p.required), description: p.description })
    }
  }
  const schema = op.requestBody?.content?.['application/json']?.schema
  return {
    summary: op.summary ?? op.description,
    params,
    query,
    ...(schema ? { body: JSON.stringify(exampleFromSchema(spec as Json, schema), null, 2) } : {}),
  }
}

/**
 * Hints from the route's own request schemas — what the app validates, so
 * no Swagger adapter is needed. Each schema is its own root for `$ref`s.
 */
export function routeHints(route: RunnerRoute): OpenApiHints | undefined {
  const { body, query, params } = route.schemas ?? {}
  if (!body && !query && !params) return undefined
  const describe = (schema: Json | undefined) =>
    Object.fromEntries(
      Object.entries<Json>(schema?.properties ?? {}).flatMap(([name, prop]) =>
        prop?.description ? [[name, String(prop.description)]] : [],
      ),
    )
  const required = new Set<string>(
    Array.isArray(query?.required) ? (query.required as string[]) : [],
  )
  const queryDescriptions = describe(query)
  return {
    params: describe(params),
    query: Object.keys((query?.properties as Json | undefined) ?? {}).map((name) => ({
      name,
      required: required.has(name),
      ...(queryDescriptions[name] ? { description: queryDescriptions[name] } : {}),
    })),
    ...(body ? { body: JSON.stringify(exampleFromSchema(body, body), null, 2) } : {}),
  }
}

/**
 * Fill what's empty from the spec: query rows the inputs don't have yet
 * (enabled only when required) and an empty body. Never overwrites.
 */
export function applyHints(inputs: RouteInputs, hints: OpenApiHints): RouteInputs {
  const have = new Set(inputs.query.map((r) => r.key))
  const query = [
    ...inputs.query,
    ...hints.query
      .filter((q) => !have.has(q.name))
      .map((q) => ({ key: q.name, value: '', enabled: q.required })),
  ]
  const body = inputs.body.trim() || !hints.body ? inputs.body : hints.body
  return { ...inputs, query, body }
}

// ── Editor ──────────────────────────────────────────────────────────────

/**
 * The "open in editor" URL. `{file}` is the absolute path; a Windows path gets
 * a leading `/` so `vscode://file{file}` stays a valid URL.
 */
export function editorLink(template: string, file: string, line: number): string {
  const path = file.replace(/\\/g, '/').replace(/^(?=[A-Za-z]:)/, '/')
  return template.replace('{file}', encodeURI(path)).replace('{line}', String(line))
}
