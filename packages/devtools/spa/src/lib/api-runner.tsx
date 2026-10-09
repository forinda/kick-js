/**
 * API runner — send a request to one of the app's routes from the dashboard.
 *
 * A sheet that slides in from the right, with one collapsible section per
 * part of the request (native `<details>`: keyboard and screen-reader
 * behaviour for free). Opened from the Routes tab (`openApiRunner(route)`);
 * mount `<ApiRunnerHost />` once in App.tsx.
 *
 * Requests go straight from the browser to the app on the same origin — no
 * proxy, so it behaves the same on every runtime. The devtools token is never
 * attached to them.
 *
 * Storage: per-route inputs in `localStorage`; default headers (which tend to
 * hold credentials) in `sessionStorage`, so they are gone when the tab closes.
 */

import {
  createEffect,
  on,
  createMemo,
  createSignal,
  For,
  Index,
  Show,
  untrack,
  type Component,
  type JSX,
} from 'solid-js'
import { store, type RouteEntry } from './store'
import { rpc } from './rpc'
import { methodColor, statusPill } from './format'
import { switchTab } from './nav'
import { Icon } from './icons'
import {
  DEFAULT_SETTINGS,
  acceptsBody,
  applyHints,
  editorLink,
  historyLabel,
  openApiHints,
  routeHints,
  environmentFor,
  loadEnvironments,
  nextEnvironmentName,
  routeKey,
  type EnvironmentsState,
  type RunnerEnvironment,
  pushHistory,
  type HistoryEntry,
  emptyInputs,
  formatBody,
  inputsKey,
  storableInputs,
  readJsonPath,
  unresolvedVariables,
  variableMap,
  isPublicRoute,
  sendsDefault,
  moveRow,
  needsConfirmation,
  pathParams,
  prepareRequest,
  publicFlagNames,
  toCurl,
  toFetch,
  type FormRow,
  type KeyValueRow,
  type RouteInputs,
  type RunnerSettings,
} from './api-runner-core'

// The single environment before named ones; read once, to carry it over.
const DEFAULTS_KEY = 'kickjs-devtools:runner:defaults'
const VARIABLES_KEY = 'kickjs-devtools:runner:variables'
const ENVIRONMENTS_KEY = 'kickjs-devtools:runner:environments'
const SETTINGS_KEY = 'kickjs-devtools:runner:settings'
/** Whether default headers + variables persist across browser sessions. */
const REMEMBER_KEY = 'kickjs-devtools:runner:remember'
const HISTORY_KEY = 'kickjs-devtools:runner:history'
const MAX_BODY_CHARS = 200_000

const [activeRoute, setActiveRoute] = createSignal<RouteEntry | null>(null)

/**
 * Bumped every time the sheet opens a route (or closes). A request only shows
 * its response if this hasn't moved since it was sent — otherwise a slow
 * response from the previous route would land under the new one, and
 * "Save to variable" would capture it. A counter, not the route object, so
 * closing and reopening the same route also invalidates the old request.
 */
let generation = 0

/** Inputs to open the next route with instead of its saved ones — set by a history restore. */
let pendingInputs: RouteInputs | null = null

/**
 * The OpenAPI spec per URL: `undefined` while loading, `null` when the app
 * doesn't serve one. Fetched once per URL per page load.
 */
const [specs, setSpecs] = createSignal<Record<string, unknown>>({})

function loadSpec(url: string): void {
  // Untracked: an effect calling this must not rerun when the spec arrives.
  if (url in untrack(specs)) return
  setSpecs((prev) => ({ ...prev, [url]: undefined }))
  fetch(url, { credentials: 'same-origin' })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null)
    .then((spec) => setSpecs((prev) => ({ ...prev, [url]: spec })))
}

/** Bumped on every open, so reopening the open route reloads its inputs too. */
const [openCount, setOpenCount] = createSignal(0)

/**
 * Open the runner for a route: select it and show the Routes tab. `params`
 * fills its path params over the saved inputs — a replayed request.
 */
export function openApiRunner(route: RouteEntry, params?: Record<string, string>): void {
  if (params) {
    const saved = load(() => localStorage, inputsKey(route), emptyInputs(route))
    pendingInputs = { ...saved, params: { ...saved.params, ...params } }
  }
  setActiveRoute(route)
  setOpenCount((n) => n + 1)
  switchTab('routes')
}

/** The route the runner shows — the Routes list highlights it. */
export { activeRoute as runnerRoute }

function load<T>(storage: () => Storage, key: string, fallback: T): T {
  try {
    const raw = storage().getItem(key)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    return fallback
  }
}

function loadRows(storage: () => Storage, key: string): KeyValueRow[] {
  try {
    const parsed: unknown = JSON.parse(storage().getItem(key) ?? '[]')
    // Anything but an array (hand-edited, or an older format) starts empty.
    return Array.isArray(parsed) ? (parsed as KeyValueRow[]) : []
  } catch {
    return []
  }
}

function remove(storage: () => Storage, key: string): void {
  try {
    storage().removeItem(key)
  } catch {
    /* storage unavailable */
  }
}

function readRemember(): boolean {
  try {
    return localStorage.getItem(REMEMBER_KEY) === 'true'
  } catch {
    return false
  }
}

function save(storage: () => Storage, key: string, value: unknown): void {
  try {
    storage().setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable (private mode) — the runner still works, unsaved */
  }
}

interface RunResult {
  /** The body as received, for "Save to variable". */
  raw: string
  status: number
  statusText: string
  ms: number
  headers: [string, string][]
  body: string
  truncated: boolean
}

const enabledCount = (rows: KeyValueRow[]) => rows.filter((r) => r.enabled && r.key).length

export const ApiRunnerPanel: Component = () => {
  const [inputs, setInputs] = createSignal<RouteInputs | null>(null)
  // Default headers and variables live in sessionStorage unless the user asks to
  // remember them: they usually hold credentials.
  const [remember, setRemember] = createSignal(readRemember())
  const envStorage = () => (remember() ? localStorage : sessionStorage)
  const otherStorage = () => (remember() ? sessionStorage : localStorage)
  const [envs, setEnvs] = createSignal<EnvironmentsState>(
    loadEnvironments(load<unknown>(envStorage, ENVIRONMENTS_KEY, null), {
      headers: loadRows(envStorage, DEFAULTS_KEY),
      variables: loadRows(envStorage, VARIABLES_KEY),
    }),
  )
  const [managing, setManaging] = createSignal(false)
  /** The environment the open route uses: its pin, else the active one. */
  const env = createMemo(() => {
    const route = activeRoute()
    return route ? environmentFor(envs(), route) : envs().environments[0]!
  })
  const updateEnv = (id: string, patch: Partial<RunnerEnvironment>) =>
    setEnvs((state) => ({
      ...state,
      // oxlint-disable-next-line no-map-spread
      environments: state.environments.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }))
  const capture = () => inputs()?.capture ?? { path: '', name: '' }
  const setCapture = (value: { path: string; name: string }) => update({ capture: value })
  const [captureNote, setCaptureNote] = createSignal<string | null>(null)
  const [settings, setSettings] = createSignal<RunnerSettings>(
    load(() => localStorage, SETTINGS_KEY, DEFAULT_SETTINGS),
  )
  const [armed, setArmed] = createSignal(false)
  const [sending, setSending] = createSignal(false)
  const [result, setResult] = createSignal<RunResult | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [copied, setCopied] = createSignal<string | null>(null)
  const [snippetKind, setSnippetKind] = createSignal<'curl' | 'fetch'>('curl')
  const [history, setHistory] = createSignal<HistoryEntry[]>(
    (() => {
      try {
        const parsed: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
        return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : []
      } catch {
        return []
      }
    })(),
  )
  const [editorNote, setEditorNote] = createSignal<string | null>(null)
  // A route opened with nothing saved takes the OpenAPI prefill once the spec arrives.
  const [awaitingPrefill, setAwaitingPrefill] = createSignal(false)

  const hints = createMemo(() => {
    const route = activeRoute()
    if (!route) return undefined
    // The Swagger spec when it documents the route (it has summaries), else
    // the route's own schemas — no Swagger adapter needed.
    const spec = specs()[settings().openApiUrl]
    return (spec ? openApiHints(spec, route) : undefined) ?? routeHints(route)
  })

  /**
   * The storage key the current inputs were loaded for. On a route change the
   * save effect can run before the load effect (Solid doesn't promise their
   * order), and would write the previous route's inputs under the new route's
   * key — which the load effect would then read back.
   */
  let loadedKey: string | null = null

  // Load the route's saved inputs whenever a route is opened.
  createEffect(() => {
    const route = activeRoute()
    openCount()
    generation++
    if (!route) return
    let isNew = false
    try {
      isNew = localStorage.getItem(inputsKey(route)) === null
    } catch {
      /* storage unavailable */
    }
    const saved = pendingInputs ?? load(() => localStorage, inputsKey(route), emptyInputs(route))
    pendingInputs = null
    // Keep params in sync with the path even if the saved inputs are older.
    const params = Object.fromEntries(pathParams(route.path).map((p) => [p, saved.params[p] ?? '']))
    loadedKey = inputsKey(route)
    setInputs({ ...saved, params })
    setAwaitingPrefill(isNew)
    setCaptureNote(null)
    setEditorNote(null)
    setResult(null)
    setError(null)
    setArmed(false)
    // A request still running for the previous route won't clear this (its
    // generation is stale), so the newly opened route starts idle.
    setSending(false)
  })

  createEffect(() => {
    const route = activeRoute()
    const current = inputs()
    if (route && current && loadedKey === inputsKey(route)) {
      save(() => localStorage, inputsKey(route), storableInputs(current))
    }
  })
  // Write the environment where `remember` says, and clear the other storage so
  // switching the toggle moves it instead of leaving a copy behind.
  createEffect(() => {
    save(envStorage, ENVIRONMENTS_KEY, envs())
    remove(otherStorage, ENVIRONMENTS_KEY)
    // Carried over into the environments: the old keys aren't needed again.
    for (const storage of [envStorage, otherStorage]) {
      remove(storage, DEFAULTS_KEY)
      remove(storage, VARIABLES_KEY)
    }
    save(() => localStorage, REMEMBER_KEY, remember())
  })
  createEffect(() => save(() => localStorage, SETTINGS_KEY, settings()))
  createEffect(() => save(() => localStorage, HISTORY_KEY, history()))
  createEffect(() => {
    if (activeRoute()) loadSpec(settings().openApiUrl)
  })
  createEffect(() => {
    const h = hints()
    if (!h || !awaitingPrefill()) return
    setAwaitingPrefill(false)
    setInputs((prev) => (prev ? applyHints(prev, h) : prev))
  })

  const prepared = createMemo(() => {
    const route = activeRoute()
    const current = inputs()
    if (!route || !current) return null
    return prepareRequest({
      route,
      inputs: current,
      defaults: env().headers,
      variables: variableMap(env().variables),
      mappings: env().mappings,
      settings: settings(),
      origin: window.location.origin,
      cookies: document.cookie,
    })
  })

  const close = () => setActiveRoute(null)

  const update = (patch: Partial<RouteInputs>) => {
    setArmed(false)
    setInputs((prev) => (prev ? { ...prev, ...patch } : prev))
  }

  async function send(): Promise<void> {
    const req = prepared()
    if (!req) return
    if (needsConfirmation(req.method) && !armed()) {
      setArmed(true)
      return
    }
    setArmed(false)
    setSending(true)
    setError(null)
    const started = performance.now()
    const sentIn = generation
    const route = activeRoute()!
    const sentInputs = inputs()!
    // Captured into the environment the request went out with, even if another is picked meanwhile.
    const sentEnvId = env().id
    const record = (outcome: Partial<HistoryEntry>) =>
      setHistory((list) =>
        pushHistory(list, {
          at: Date.now(),
          method: route.method.toUpperCase(),
          path: route.path,
          inputs: sentInputs,
          ms: Math.round(performance.now() - started),
          ...outcome,
        }),
      )
    try {
      const res = await fetch(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.body,
        credentials: 'same-origin',
      })
      const text = await res.text()
      record({ status: res.status })
      if (sentIn !== generation) return
      setResult({
        status: res.status,
        statusText: res.statusText,
        ms: Math.round(performance.now() - started),
        headers: [...res.headers.entries()],
        raw: text,
        body: formatBody(text.slice(0, MAX_BODY_CHARS), res.headers.get('content-type')),
        truncated: text.length > MAX_BODY_CHARS,
      })
      // The route's own "Save to variable" runs after every success: log in, and the token's set.
      if (res.ok && sentInputs.capture) captureInto(text, sentInputs.capture, sentEnvId)
    } catch (err) {
      record({ error: err instanceof Error ? err.message : String(err) })
      if (sentIn !== generation) return
      setResult(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (sentIn === generation) setSending(false)
    }
  }

  // The snippet is rendered in the sheet, so it can be read and selected by
  // hand; the Copy button is only a shortcut.
  const snippet = createMemo(() => {
    const req = prepared()
    if (!req) return ''
    return snippetKind() === 'curl' ? toCurl(req) : toFetch(req)
  })

  async function copySnippet(): Promise<void> {
    try {
      await navigator.clipboard.writeText(snippet())
      setCopied('Copied')
    } catch {
      setCopied('Copy failed — select the text instead')
    }
    setTimeout(() => setCopied(null), 1500)
  }

  // "Save to variable": read a JSON path out of the last response and set (or
  // add) the variable — log in once, then {{token}} fills every request.
  function captureVariable(): void {
    const res = result()
    if (res) captureInto(res.raw, capture(), env().id)
  }

  /** Read `capture.path` out of a response body into variable `capture.name` of environment `envId`. */
  function captureInto(raw: string, capture: { path: string; name: string }, envId: string): void {
    const path = capture.path
    const name = capture.name
    if (!path.trim() || !name.trim()) return
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      setCaptureNote('The response is not JSON')
      return
    }
    const value = readJsonPath(json, path.trim())
    if (value === undefined) {
      setCaptureNote(`Nothing at "${path.trim()}"`)
      return
    }
    const key = name.trim()
    // Into the environment this route uses — log in under "admin", and only it gets the token.
    const target = envs().environments.find((e) => e.id === envId)
    if (!target) return
    const rows = target.variables
    updateEnv(target.id, {
      variables: rows.some((r) => r.key === key)
        ? rows.map((r) => (r.key === key ? { ...r, value, enabled: true } : r))
        : [...rows, { key, value, enabled: true, secret: true }],
    })
    setCaptureNote(`Saved {{${key}}} in ${target.name}`)
  }

  /** Reopen a past request: its route, with the inputs it was sent with. */
  function restore(entry: HistoryEntry): void {
    const route = store
      .routes()
      .find((r) => r.method.toUpperCase() === entry.method && r.path === entry.path)
    if (!route) return
    pendingInputs = entry.inputs
    // Same route: the open effect won't rerun, so set the inputs directly.
    if (route === activeRoute()) {
      pendingInputs = null
      update(entry.inputs)
    } else {
      setActiveRoute(route)
    }
  }

  async function openInEditor(): Promise<void> {
    const route = activeRoute()
    if (!route) return
    setEditorNote(null)
    try {
      const src = await rpc.source(route.controller, route.handler)
      window.location.href = editorLink(settings().editorUrl, src.file, src.line)
      setEditorNote(`${src.relative}:${src.line}`)
    } catch {
      setEditorNote('Source not found under src/')
    }
  }

  const isPublic = () => {
    const route = activeRoute()
    return route ? isPublicRoute(route, settings()) : false
  }

  return (
    <Show
      when={activeRoute()}
      fallback={
        <div class="dt-panel-grid">
          <div class="card text-sm text-text-muted">Select a route to try it</div>
        </div>
      }
    >
      {(route) => (
        <div class="h-full flex flex-col min-h-0">
          <Show when={managing()}>
            <EnvironmentsSheet
              state={envs()}
              setState={setEnvs}
              selectedId={env().id}
              remember={remember()}
              setRemember={setRemember}
              onClose={() => setManaging(false)}
            />
          </Show>
          <section
            aria-label={`Try ${route().method} ${route().path}`}
            class="h-full bg-surface-1 flex flex-col min-h-0"
          >
            {/* Header */}
            <header class="px-5 py-4 border-b border-border">
              <div class="flex items-start justify-between gap-4">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <span class={`text-xs font-bold ${methodColor(route().method)}`}>
                      {route().method.toUpperCase()}
                    </span>
                    <h2 class="text-base font-semibold font-mono text-text-body break-all">
                      {route().path}
                    </h2>
                  </div>
                  <p class="text-xs text-text-muted mt-1">
                    <button
                      type="button"
                      class="underline decoration-dotted hover:text-kick-500"
                      title="Open in editor"
                      onClick={openInEditor}
                    >
                      {route().controller}.{route().handler}
                    </button>
                    <Show when={editorNote()}> · {editorNote()}</Show>
                    <Show when={isPublic()}>
                      {' '}
                      · public route — default Authorization off unless ticked under Headers
                    </Show>
                  </p>
                  <Show when={hints()?.summary}>
                    <p class="text-sm text-text-secondary mt-1">{hints()!.summary}</p>
                  </Show>
                </div>
                <button
                  type="button"
                  class="text-text-muted hover:text-text-strong p-1 text-lg leading-none"
                  aria-label="Close"
                  onClick={close}
                >
                  ✕
                </button>
              </div>
              {/* Send bar: method, the resolved URL, and Send — the request at a glance. */}
              <div class="flex items-stretch gap-2 mt-3">
                <div class="flex-1 min-w-0 flex items-center gap-2 font-mono text-xs bg-surface-2 border border-border rounded-lg px-3 py-2 text-text-secondary">
                  <span class={`font-bold ${methodColor(route().method)}`}>
                    {route().method.toUpperCase()}
                  </span>
                  <span class="break-all">{prepared()?.url}</span>
                </div>
                <button
                  type="button"
                  disabled={sending()}
                  onClick={send}
                  class={`shrink-0 px-4 text-sm font-semibold rounded-lg border transition-colors ${
                    armed()
                      ? 'bg-red-500/20 text-red-400 border-red-500/40'
                      : 'bg-kick-500/20 text-kick-500 border-kick-500/30 hover:bg-kick-500/30'
                  }`}
                >
                  {sending()
                    ? 'Sending…'
                    : armed()
                      ? `Confirm ${route().method.toUpperCase()}`
                      : 'Send'}
                </button>
              </div>
              {/* Environment: the active one, or the one this route is pinned to. */}
              <div class="flex items-center gap-2 mt-2 text-xs text-text-muted">
                <label class="flex items-center gap-2">
                  Environment
                  <select
                    class="bg-surface-2 border border-border-strong rounded-lg px-2 py-1 text-xs text-text-body"
                    value={envs().pins[routeKey(route())] ?? ''}
                    onChange={(e) => {
                      const id = e.currentTarget.value
                      const key = routeKey(route())
                      setEnvs((state) => {
                        const pins = { ...state.pins }
                        if (id) pins[key] = id
                        else delete pins[key]
                        return { ...state, pins }
                      })
                    }}
                  >
                    <option value="">
                      Active ({envs().environments.find((e) => e.id === envs().activeId)?.name})
                    </option>
                    <For each={envs().environments}>
                      {(e) => <option value={e.id}>Pinned: {e.name}</option>}
                    </For>
                  </select>
                </label>
                <button
                  type="button"
                  class="underline hover:text-kick-500"
                  onClick={() => setManaging(true)}
                >
                  Manage…
                </button>
              </div>
              <Show when={prepared() && unresolvedVariables(prepared()!).length > 0}>
                <p class="text-xs text-amber-400 mt-2">
                  No value for{' '}
                  {unresolvedVariables(prepared()!)
                    .map((v) => `{{${v}}}`)
                    .join(', ')}{' '}
                  in <strong>{env().name}</strong> —{' '}
                  <button type="button" class="underline" onClick={() => setManaging(true)}>
                    add it to the environment
                  </button>
                  .
                </p>
              </Show>
            </header>

            {/* Sections */}
            <div class="flex-1 overflow-y-auto px-5 py-3 flex flex-col gap-2">
              <Show when={inputs()}>
                {(current) => (
                  <>
                    <Show when={pathParams(route().path).length > 0}>
                      <Section title="Path params" open>
                        <div class="flex flex-col gap-2">
                          <For each={pathParams(route().path)}>
                            {(name) => (
                              <label class="flex items-center gap-3 text-sm">
                                <span class="font-mono text-text-secondary w-28 shrink-0">
                                  :{name}
                                </span>
                                <input
                                  class={inputClass}
                                  placeholder={hints()?.params[name]}
                                  value={current().params[name] ?? ''}
                                  onInput={(e) =>
                                    update({
                                      params: {
                                        ...current().params,
                                        [name]: e.currentTarget.value,
                                      },
                                    })
                                  }
                                />
                              </label>
                            )}
                          </For>
                        </div>
                      </Section>
                    </Show>

                    <Section title="Query" count={enabledCount(current().query)}>
                      <RowsEditor
                        rows={current().query}
                        onChange={(query) => update({ query })}
                        context={routeKey(route())}
                      />
                      <Show when={hints()?.query.length}>
                        <ul class="text-xs text-text-muted mt-2 flex flex-col gap-0.5">
                          <For each={hints()!.query}>
                            {(q) => (
                              <li>
                                <code>{q.name}</code>
                                {q.required ? ' (required)' : ''}
                                {q.description ? ` — ${q.description}` : ''}
                              </li>
                            )}
                          </For>
                        </ul>
                      </Show>
                    </Section>

                    <Section title="Headers" count={enabledCount(current().headers)}>
                      <RowsEditor
                        rows={current().headers}
                        onChange={(headers) => update({ headers })}
                        context={routeKey(route())}
                      />
                      <Show when={env().headers.some((h) => h.enabled && h.key)}>
                        <div class="mt-3 text-xs">
                          <p class="text-text-muted mb-1">
                            From <strong>{env().name}</strong> — untick to leave one off this route
                            only:
                          </p>
                          <For each={env().headers.filter((h) => h.enabled && h.key)}>
                            {(h) => {
                              const name = h.key.toLowerCase()
                              const sent = () => sendsDefault(route(), current(), settings(), name)
                              return (
                                <label class="flex items-center gap-2 font-mono text-text-secondary">
                                  <input
                                    type="checkbox"
                                    checked={sent()}
                                    onChange={(e) =>
                                      update({
                                        defaultHeaders: {
                                          ...current().defaultHeaders,
                                          [name]: e.currentTarget.checked,
                                        },
                                      })
                                    }
                                  />
                                  <span class={sent() ? '' : 'line-through text-text-muted'}>
                                    {h.key}: {h.secret ? '••••••' : h.value}
                                  </span>
                                  <Show
                                    when={
                                      name === 'authorization' &&
                                      isPublic() &&
                                      current().defaultHeaders?.[name] === undefined
                                    }
                                  >
                                    <span class="font-sans text-text-muted">
                                      (off by default: public route)
                                    </span>
                                  </Show>
                                </label>
                              )
                            }}
                          </For>
                        </div>
                      </Show>
                    </Section>

                    <Show when={acceptsBody(route().method)}>
                      <Section title="Body" open>
                        <div class="flex items-center gap-1 mb-2">
                          <For
                            each={
                              [
                                ['raw', 'Raw'],
                                ['form', 'Form data'],
                              ] as const
                            }
                          >
                            {([mode, label]) => (
                              <button
                                type="button"
                                aria-pressed={(current().bodyMode ?? 'raw') === mode}
                                onClick={() => update({ bodyMode: mode })}
                                class={`px-3 py-1 text-xs font-semibold rounded-lg border transition-colors ${
                                  (current().bodyMode ?? 'raw') === mode
                                    ? 'bg-kick-500/20 text-kick-500 border-kick-500/30'
                                    : 'bg-surface-2 text-text-secondary border-border-strong hover:text-text-body'
                                }`}
                              >
                                {label}
                              </button>
                            )}
                          </For>
                          <Show when={route().upload && route().upload!.mode !== 'none'}>
                            <span class="text-xs text-text-muted ml-2">
                              @FileUpload: field <code>{route().upload!.fieldName ?? 'file'}</code>
                              {route().upload!.mode === 'array'
                                ? `, up to ${route().upload!.maxCount ?? 10} files`
                                : ', one file'}
                            </span>
                          </Show>
                        </div>
                        <Show
                          when={current().bodyMode === 'form'}
                          fallback={
                            <textarea
                              class={`${inputClass} font-mono min-h-40`}
                              placeholder='{ "name": "value" }'
                              value={current().body}
                              onInput={(e) => update({ body: e.currentTarget.value })}
                            />
                          }
                        >
                          <FormEditor
                            rows={current().form ?? []}
                            multiple={route().upload?.mode === 'array'}
                            onChange={(form) => update({ form })}
                          />
                          <p class="text-xs text-text-muted mt-2">
                            Sent as multipart/form-data. Picked files aren't saved — pick them again
                            after reopening.
                          </p>
                        </Show>
                      </Section>
                    </Show>
                  </>
                )}
              </Show>

              <Section title="Settings">
                <Show when={hints()}>
                  {(h) => (
                    <button
                      type="button"
                      class={secondaryButton}
                      onClick={() => update(applyHints(inputs()!, h()))}
                    >
                      Fill empty inputs from OpenAPI
                    </button>
                  )}
                </Show>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                  <label class="flex flex-col gap-1 text-xs text-text-muted">
                    Public route flags (comma-separated)
                    <span class="text-[0.7rem]">
                      On routes carrying one of these flags (e.g. <code>auth.public</code> from your
                      auth setup), the environment's default Authorization header starts unticked —
                      a login route needs no token — and is sent only if you tick it under the
                      route's Headers. Names your app uses; the runner adds no flags to the request.
                    </span>
                    <input
                      class={inputClass}
                      value={publicFlagNames(settings().publicFlag).join(', ')}
                      onChange={(e) =>
                        setSettings({
                          ...settings(),
                          publicFlag: publicFlagNames(e.currentTarget.value),
                        })
                      }
                    />
                  </label>
                  <For
                    each={
                      [
                        ['csrfCookie', 'CSRF cookie'],
                        ['csrfHeader', 'CSRF header'],
                        ['openApiUrl', 'OpenAPI spec URL'],
                        ['editorUrl', 'Editor link ({file}, {line})'],
                      ] as const
                    }
                  >
                    {([key, label]) => (
                      <label class="flex flex-col gap-1 text-xs text-text-muted">
                        {label}
                        <input
                          class={inputClass}
                          value={settings()[key]}
                          onInput={(e) =>
                            setSettings({ ...settings(), [key]: e.currentTarget.value })
                          }
                        />
                      </label>
                    )}
                  </For>
                </div>
              </Section>

              <Section title="Code snippet">
                <div class="flex items-center gap-1 mb-2">
                  <For each={['curl', 'fetch'] as const}>
                    {(kind) => (
                      <button
                        type="button"
                        aria-pressed={snippetKind() === kind}
                        onClick={() => setSnippetKind(kind)}
                        class={`px-3 py-1 text-xs font-semibold rounded-lg border transition-colors ${
                          snippetKind() === kind
                            ? 'bg-kick-500/20 text-kick-500 border-kick-500/30'
                            : 'bg-surface-2 text-text-secondary border-border-strong hover:text-text-body'
                        }`}
                      >
                        {kind}
                      </button>
                    )}
                  </For>
                  <button type="button" class={`${secondaryButton} ml-auto`} onClick={copySnippet}>
                    Copy
                  </button>
                  <Show when={copied()}>
                    <span class="text-xs text-text-muted" role="status">
                      {copied()}
                    </span>
                  </Show>
                </div>
                <pre class="text-xs font-mono bg-surface-2 border border-border rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all select-text">
                  {snippet()}
                </pre>
              </Section>

              <Show when={error()}>
                <div class="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                  Request failed: {error()}
                </div>
              </Show>

              <Show when={result()}>
                {(res) => (
                  <Section
                    open
                    title={
                      <span class="flex items-center gap-3">
                        Response
                        <span class={statusPill(res().status)}>
                          {res().status} {res().statusText}
                        </span>
                        <span class="text-text-muted text-xs font-normal">{res().ms} ms</span>
                      </span>
                    }
                  >
                    <details class="text-xs mb-2">
                      <summary class="cursor-pointer text-text-secondary">
                        Response headers ({res().headers.length})
                      </summary>
                      <table class="mt-2">
                        <tbody>
                          <For each={res().headers}>
                            {([k, v]) => (
                              <tr>
                                <td class="font-mono text-text-secondary pr-4">{k}</td>
                                <td class="font-mono break-all">{v}</td>
                              </tr>
                            )}
                          </For>
                        </tbody>
                      </table>
                    </details>
                    <pre class="text-xs font-mono bg-surface-2 border border-border rounded-lg p-3 overflow-x-auto max-h-[50vh] whitespace-pre-wrap break-all">
                      {res().body || '(empty body)'}
                    </pre>
                    <div class="flex flex-col sm:flex-row sm:items-center gap-2 mt-3 text-xs">
                      <span class="text-text-secondary font-semibold shrink-0">
                        Save to variable
                      </span>
                      <input
                        class={inputClass}
                        placeholder="JSON path, e.g. data.accessToken"
                        value={capture().path}
                        onInput={(e) => setCapture({ ...capture(), path: e.currentTarget.value })}
                      />
                      <input
                        class={inputClass}
                        placeholder="variable, e.g. token"
                        value={capture().name}
                        onInput={(e) => setCapture({ ...capture(), name: e.currentTarget.value })}
                      />
                      <button type="button" class={secondaryButton} onClick={captureVariable}>
                        Save
                      </button>
                    </div>
                    <Show when={captureNote()}>
                      <p class="text-xs text-text-muted mt-1" role="status">
                        {captureNote()}
                      </p>
                    </Show>
                    <Show when={res().truncated}>
                      <p class="mt-1 text-xs text-text-muted">
                        Body truncated to {MAX_BODY_CHARS.toLocaleString()} characters.
                      </p>
                    </Show>
                  </Section>
                )}
              </Show>

              <Section title="History" count={history().length}>
                <Show
                  when={history().length > 0}
                  fallback={<p class="text-xs text-text-muted">Nothing sent yet.</p>}
                >
                  <ul class="flex flex-col gap-1">
                    <For each={history()}>
                      {(entry) => (
                        <li>
                          <button
                            type="button"
                            class="w-full flex items-center gap-2 text-xs text-left rounded px-2 py-1 hover:bg-surface-2"
                            title="Open with these inputs"
                            onClick={() => restore(entry)}
                          >
                            <span class={`font-bold w-14 shrink-0 ${methodColor(entry.method)}`}>
                              {entry.method}
                            </span>
                            <span class="font-mono truncate flex-1">{historyLabel(entry)}</span>
                            <span
                              class={
                                entry.status ? statusPill(entry.status) : 'dt-pill dt-pill-err'
                              }
                            >
                              {entry.status ?? 'failed'}
                            </span>
                            <span class="text-text-muted w-16 text-right">{entry.ms} ms</span>
                            <span class="text-text-muted w-16 text-right">
                              {new Date(entry.at).toLocaleTimeString()}
                            </span>
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                  <button
                    type="button"
                    class={`${secondaryButton} mt-2`}
                    onClick={() => setHistory([])}
                  >
                    Clear history
                  </button>
                </Show>
              </Section>
            </div>
          </section>
        </div>
      )}
    </Show>
  )
}

/** One collapsible block of the sheet — a native `<details>`. */
const Section: Component<{
  title: JSX.Element
  count?: number
  open?: boolean
  children: JSX.Element
}> = (props) => (
  <details open={props.open} class="border border-border rounded-lg bg-surface-1 group">
    <summary class="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-text-body flex items-center gap-2">
      <span class="text-text-muted transition-transform group-open:rotate-90">▸</span>
      {props.title}
      <Show when={props.count}>
        <span class="text-xs font-normal text-text-muted">({props.count})</span>
      </Show>
    </summary>
    <div class="px-3 pb-3">{props.children}</div>
  </details>
)

/**
 * Multipart rows: a text field or a file picker each, plus one blank row.
 * `<Index>` for the same focus reason as `RowsEditor`.
 */
const FormEditor: Component<{
  rows: FormRow[]
  multiple: boolean
  onChange: (rows: FormRow[]) => void
}> = (props) => {
  const rows = (): FormRow[] => [...props.rows, { key: '', value: '', enabled: true, type: 'text' }]
  const set = (index: number, patch: Partial<FormRow>) => {
    // Copy-on-write on purpose: mutating a row in place would not re-render it.
    // oxlint-disable-next-line no-map-spread
    const next = rows().map((row, i) => (i === index ? { ...row, ...patch } : row))
    props.onChange(next.filter((row) => row.key || row.value || row.files?.length))
  }
  return (
    <div class="flex flex-col gap-2">
      <Index each={rows()}>
        {(row, i) => (
          <div class="flex items-center gap-2">
            <input
              type="checkbox"
              aria-label="Enabled"
              checked={row().enabled}
              onChange={(e) => set(i, { enabled: e.currentTarget.checked })}
            />
            <select
              aria-label="Field type"
              class={`${inputClass} w-24 shrink-0`}
              value={row().type}
              onChange={(e) =>
                set(i, { type: e.currentTarget.value as FormRow['type'], value: '', files: [] })
              }
            >
              <option value="text">Text</option>
              <option value="file">File</option>
            </select>
            <input
              class={inputClass}
              placeholder="name"
              value={row().key}
              onInput={(e) => set(i, { key: e.currentTarget.value })}
            />
            <Show
              when={row().type === 'file'}
              fallback={
                <input
                  class={inputClass}
                  placeholder="value"
                  value={row().value}
                  onInput={(e) => set(i, { value: e.currentTarget.value })}
                />
              }
            >
              <label class={`${inputClass} cursor-pointer truncate`}>
                <input
                  type="file"
                  class="sr-only"
                  multiple={props.multiple}
                  onChange={(e) => set(i, { files: [...(e.currentTarget.files ?? [])] })}
                />
                {row().files?.length
                  ? row()
                      .files!.map((f) => f.name)
                      .join(', ')
                  : 'Choose file…'}
              </label>
            </Show>
          </div>
        )}
      </Index>
    </div>
  )
}

/**
 * Key/value rows with enable toggles; always shows one blank row to type into.
 * `<Index>` (keyed by position), not `<For>` (keyed by object identity): every
 * keystroke builds a new row object, and `<For>` would rebuild the input and
 * drop focus on each one.
 */
const RowsEditor: Component<{
  rows: KeyValueRow[]
  onChange: (rows: KeyValueRow[]) => void
  keyPlaceholder?: string
  valuePlaceholder?: string
  /** What the rows belong to (a route, an environment): a change resets reveal and expand. */
  context?: string
}> = (props) => {
  const rows = (): KeyValueRow[] => [...props.rows, { key: '', value: '', enabled: true }]
  const set = (index: number, patch: Partial<KeyValueRow>) => {
    // Copy-on-write on purpose: mutating a row in place would not re-render it.
    // oxlint-disable-next-line no-map-spread
    const next = rows().map((row, i) => (i === index ? { ...row, ...patch } : row))
    props.onChange(next.filter((row) => row.key || row.value))
  }
  // Per row, not saved: a revealed secret is masked again on reopen.
  const [revealed, setRevealed] = createSignal<ReadonlySet<number>>(new Set())
  const [expanded, setExpanded] = createSignal<number | null>(null)
  // Both are by index: kept across a switch, they'd reveal another set's row 0.
  createEffect(
    on(
      () => props.context,
      () => {
        setRevealed(new Set<number>())
        setExpanded(null)
      },
      { defer: true },
    ),
  )
  const flip = (i: number) => {
    const next = new Set(revealed())
    if (!next.delete(i)) next.add(i)
    setRevealed(next)
  }
  const masked = (i: number) => !!rows()[i]?.secret && !revealed().has(i)
  const remove = (i: number) => {
    setRevealed(new Set<number>())
    setExpanded(null)
    props.onChange(props.rows.filter((_, j) => j !== i))
  }
  const iconButton = 'shrink-0 p-1 text-text-muted hover:text-text-body'
  // Drag by the handle to reorder: order matters, a later header replaces an earlier one.
  const [dragging, setDragging] = createSignal<number | null>(null)
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= props.rows.length) return
    setRevealed(new Set<number>())
    setExpanded(null)
    props.onChange(moveRow(props.rows, from, to))
  }
  const drop = (to: number) => {
    const from = dragging()
    setDragging(null)
    if (from !== null) move(from, to)
  }
  let list: HTMLDivElement | undefined
  /** Keyboard reorder: ↑ / ↓ on the handle, which keeps focus as its row moves. */
  const nudge = (e: KeyboardEvent, i: number) => {
    const to = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : null
    if (to === null || to < 0 || to >= props.rows.length) return
    e.preventDefault()
    move(i, to)
    list?.querySelectorAll<HTMLElement>('[data-handle]')[to]?.focus()
  }
  return (
    <div class="flex flex-col gap-2" ref={(el) => (list = el)}>
      <Index each={rows()}>
        {(row, i) => (
          <div
            class={`flex flex-col gap-1 ${dragging() === i ? 'opacity-50' : ''}`}
            onDragOver={(e) => {
              if (dragging() !== null && i < props.rows.length) e.preventDefault()
            }}
            onDrop={(e) => {
              e.preventDefault()
              drop(i)
            }}
          >
            <div class="flex items-center gap-2">
              <button
                type="button"
                data-handle
                draggable={i < props.rows.length}
                tabIndex={i < props.rows.length ? 0 : -1}
                aria-label={`Move row ${i + 1}: drag, or press up or down arrow`}
                title="Drag, or ↑ / ↓, to reorder"
                class={`shrink-0 select-none border-0 bg-transparent p-0 text-text-muted ${
                  i < props.rows.length ? 'cursor-grab' : 'invisible'
                }`}
                onKeyDown={(e) => nudge(e, i)}
                onDragStart={(e) => {
                  setDragging(i)
                  e.dataTransfer?.setData('text/plain', String(i))
                }}
                onDragEnd={() => setDragging(null)}
              >
                ⠿
              </button>
              <input
                type="checkbox"
                aria-label="Enabled"
                checked={row().enabled}
                onChange={(e) => set(i, { enabled: e.currentTarget.checked })}
              />
              <input
                class={inputClass}
                placeholder={props.keyPlaceholder ?? 'name'}
                value={row().key}
                onInput={(e) => set(i, { key: e.currentTarget.value })}
              />
              <input
                class={inputClass}
                type={masked(i) ? 'password' : 'text'}
                autocomplete="off"
                placeholder={props.valuePlaceholder ?? 'value'}
                value={row().value}
                onInput={(e) => set(i, { value: e.currentTarget.value })}
              />
              {/* The trailing blank row is where new rows are typed: no actions on it. */}
              <div class={`flex items-center ${i === props.rows.length ? 'invisible' : ''}`}>
                <Show when={row().secret}>
                  <button
                    type="button"
                    class={iconButton}
                    aria-pressed={!masked(i)}
                    aria-label={masked(i) ? 'Show value' : 'Hide value'}
                    title={masked(i) ? 'Show value' : 'Hide value'}
                    onClick={() => flip(i)}
                  >
                    <Icon name="eye" size={14} />
                  </button>
                </Show>
                <button
                  type="button"
                  class={iconButton}
                  aria-pressed={!!row().secret}
                  aria-label={row().secret ? 'Secret: masked' : 'Mark as secret'}
                  title={row().secret ? 'Secret: masked — click to stop masking' : 'Mark as secret'}
                  onClick={() => set(i, { secret: !row().secret })}
                >
                  <Icon name={row().secret ? 'lock' : 'unlock'} size={14} />
                </button>
                <button
                  type="button"
                  class={iconButton}
                  aria-expanded={expanded() === i}
                  aria-label="Edit the whole value"
                  title="Edit the whole value"
                  onClick={() => setExpanded(expanded() === i ? null : i)}
                >
                  <Icon name="maximize" size={14} />
                </button>
                <button
                  type="button"
                  class={iconButton}
                  aria-label="Remove row"
                  title="Remove row"
                  onClick={() => remove(i)}
                >
                  ✕
                </button>
              </div>
            </div>
            {/* Long values (a JWT) don't fit the inline box: the whole value, wrapped. */}
            <Show when={expanded() === i}>
              <textarea
                class={`${inputClass} font-mono text-xs min-h-24 break-all`}
                aria-label={`${row().key || 'value'} — whole value`}
                value={masked(i) ? '•'.repeat(Math.min(row().value.length, 64)) : row().value}
                readOnly={masked(i)}
                onInput={(e) => set(i, { value: e.currentTarget.value })}
              />
              <Show when={masked(i)}>
                <p class="text-xs text-text-muted">Masked — show it to read or edit.</p>
              </Show>
            </Show>
          </div>
        )}
      </Index>
    </div>
  )
}

/**
 * The environments, in a sheet of their own: each one's default headers,
 * variables and param mappings, which one is active, and adding, duplicating,
 * renaming and removing them.
 */
const EnvironmentsSheet: Component<{
  state: EnvironmentsState
  setState: (update: (state: EnvironmentsState) => EnvironmentsState) => void
  /** Shown first: the environment the open route uses. */
  selectedId: string
  remember: boolean
  setRemember: (remember: boolean) => void
  onClose: () => void
}> = (props) => {
  const [selected, setSelected] = createSignal(props.selectedId)
  const current = () =>
    props.state.environments.find((e) => e.id === selected()) ?? props.state.environments[0]!
  const patch = (update: Partial<RunnerEnvironment>) =>
    props.setState((state) => ({
      ...state,
      // oxlint-disable-next-line no-map-spread
      environments: state.environments.map((e) =>
        e.id === current().id ? { ...e, ...update } : e,
      ),
    }))
  const copyRows = (list: KeyValueRow[]) => list.map((r) => ({ ...r }))
  const add = (from?: RunnerEnvironment) => {
    const id = `env-${Date.now().toString(36)}`
    props.setState((state) => ({
      ...state,
      environments: [
        ...state.environments,
        {
          id,
          name: from ? `${from.name} copy` : nextEnvironmentName(state),
          headers: from ? copyRows(from.headers) : [],
          variables: from ? copyRows(from.variables) : [],
          mappings: from ? copyRows(from.mappings) : [],
        },
      ],
    }))
    setSelected(id)
  }
  const removeCurrent = () => {
    const id = current().id
    props.setState((state) => {
      const environments = state.environments.filter((e) => e.id !== id)
      // Routes pinned to it go back to the active environment.
      const pins = Object.fromEntries(Object.entries(state.pins).filter(([, pin]) => pin !== id))
      const activeId = state.activeId === id ? environments[0]!.id : state.activeId
      return { environments, activeId, pins }
    })
    setSelected(props.state.environments[0]!.id)
  }
  const pinnedCount = (id: string) =>
    Object.values(props.state.pins).filter((pin) => pin === id).length

  return (
    <div
      class="fixed inset-0 z-70 flex justify-end bg-black/45"
      onClick={(e) => e.target === e.currentTarget && props.onClose()}
      onKeyDown={(e) => e.key === 'Escape' && props.onClose()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Environments"
        class="h-full w-full max-w-2xl bg-surface-1 border-l border-border flex flex-col"
      >
        <header class="px-5 py-4 border-b border-border flex items-start justify-between gap-4">
          <div>
            <h2 class="text-base font-semibold text-text-body">Environments</h2>
            <p class="text-xs text-text-muted mt-1">
              What requests carry — default headers, <code>{'{{variables}}'}</code> and param
              mappings. One is active; a route can be pinned to another from its runner.
            </p>
          </div>
          <button
            type="button"
            class="text-text-muted hover:text-text-strong p-1 text-lg leading-none"
            aria-label="Close"
            onClick={() => props.onClose()}
          >
            ✕
          </button>
        </header>

        <div class="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          <label class="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              class="mt-1"
              checked={props.remember}
              onChange={(e) => props.setRemember(e.currentTarget.checked)}
            />
            <span>
              Remember on this browser
              <span class="block text-xs text-text-muted">
                {props.remember
                  ? 'Saved in localStorage and kept after the tab closes. Environments may hold tokens — turn this off on a shared machine.'
                  : 'Kept for this browser tab only.'}
              </span>
            </span>
          </label>

          <div class="flex flex-wrap items-center gap-1" role="tablist" aria-label="Environment">
            <For each={props.state.environments}>
              {(e) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={e.id === current().id}
                  onClick={() => setSelected(e.id)}
                  class={`px-3 py-1 text-xs font-semibold rounded-lg border transition-colors ${
                    e.id === current().id
                      ? 'bg-kick-500/20 text-kick-500 border-kick-500/30'
                      : 'bg-surface-2 text-text-secondary border-border-strong hover:text-text-body'
                  }`}
                >
                  {e.name || '(unnamed)'}
                  {e.id === props.state.activeId ? ' · active' : ''}
                </button>
              )}
            </For>
            <button type="button" class={secondaryButton} onClick={() => add()}>
              + Add
            </button>
          </div>

          <div class="flex flex-wrap items-end gap-2">
            <label class="flex flex-col gap-1 text-xs text-text-muted grow">
              Name
              <input
                class={inputClass}
                value={current().name}
                onInput={(e) => patch({ name: e.currentTarget.value })}
              />
            </label>
            <button
              type="button"
              class={secondaryButton}
              disabled={current().id === props.state.activeId}
              onClick={() => props.setState((state) => ({ ...state, activeId: current().id }))}
            >
              {current().id === props.state.activeId ? 'Active' : 'Make active'}
            </button>
            <button type="button" class={secondaryButton} onClick={() => add(current())}>
              Duplicate
            </button>
            <button
              type="button"
              class={secondaryButton}
              disabled={props.state.environments.length === 1}
              title={
                pinnedCount(current().id)
                  ? `${pinnedCount(current().id)} pinned route(s) go back to the active environment`
                  : undefined
              }
              onClick={removeCurrent}
            >
              Delete
            </button>
          </div>

          <div>
            <h3 class="text-xs font-semibold text-text-secondary mb-1">Default headers</h3>
            <p class="text-xs text-text-muted mb-2">
              Sent with every route using this environment. A route can untick any of them under its
              own Headers; on routes carrying a public flag, Authorization starts unticked.
            </p>
            <RowsEditor
              rows={current().headers}
              onChange={(headers) => patch({ headers })}
              context={current().id}
            />
          </div>

          <div>
            <h3 class="text-xs font-semibold text-text-secondary mb-1">Variables</h3>
            <p class="text-xs text-text-muted mb-2">
              <code>{'{{name}}'}</code> in any param, query, header or body value — e.g.{' '}
              <code>Authorization: Bearer {'{{token}}'}</code>. A variable named like a path or
              query param also fills it when it's left empty.
            </p>
            <RowsEditor
              rows={current().variables}
              onChange={(variables) => patch({ variables })}
              context={current().id}
            />
          </div>

          <div>
            <h3 class="text-xs font-semibold text-text-secondary mb-1">Param mappings</h3>
            <p class="text-xs text-text-muted mb-2">
              For names that differ: an empty <code>:tenantId</code> takes the variable{' '}
              <code>orgId</code>. Typed values always win.
            </p>
            <RowsEditor
              rows={current().mappings}
              onChange={(mappings) => patch({ mappings })}
              context={current().id}
              keyPlaceholder="param or query name"
              valuePlaceholder="variable"
            />
          </div>
        </div>
      </section>
    </div>
  )
}

const inputClass =
  'w-full min-w-0 bg-surface-2 border border-border-strong rounded-lg px-3 py-1.5 text-sm text-text-body placeholder:text-text-muted focus:outline-none focus:border-kick-500'
const secondaryButton =
  'px-3 py-2 text-xs font-semibold rounded-lg border bg-surface-2 text-text-secondary border-border-strong hover:text-text-body'
