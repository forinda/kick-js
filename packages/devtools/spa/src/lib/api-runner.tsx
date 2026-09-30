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
  createMemo,
  createSignal,
  For,
  Index,
  onCleanup,
  Show,
  type Component,
  type JSX,
} from 'solid-js'
import type { RouteEntry } from './store'
import { methodColor } from './format'
import {
  DEFAULT_SETTINGS,
  acceptsBody,
  emptyInputs,
  formatBody,
  inputsKey,
  storableInputs,
  readJsonPath,
  unresolvedVariables,
  variableMap,
  isPublicRoute,
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

const DEFAULTS_KEY = 'kickjs-devtools:runner:defaults'
const VARIABLES_KEY = 'kickjs-devtools:runner:variables'
const SETTINGS_KEY = 'kickjs-devtools:runner:settings'
/** Whether default headers + variables persist across browser sessions. */
const REMEMBER_KEY = 'kickjs-devtools:runner:remember'
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

/** Open the runner for a route. */
export function openApiRunner(route: RouteEntry): void {
  setActiveRoute(route)
}

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
    const raw = storage().getItem(key)
    return raw ? (JSON.parse(raw) as KeyValueRow[]) : []
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

export const ApiRunnerHost: Component = () => {
  const [inputs, setInputs] = createSignal<RouteInputs | null>(null)
  // Default headers and variables live in sessionStorage unless the user asks to
  // remember them: they usually hold credentials.
  const [remember, setRemember] = createSignal(readRemember())
  const envStorage = () => (remember() ? localStorage : sessionStorage)
  const otherStorage = () => (remember() ? sessionStorage : localStorage)
  const [defaults, setDefaults] = createSignal<KeyValueRow[]>(loadRows(envStorage, DEFAULTS_KEY))
  const [variables, setVariables] = createSignal<KeyValueRow[]>(loadRows(envStorage, VARIABLES_KEY))
  const [capture, setCapture] = createSignal({ path: '', name: '' })
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

  // Load the route's saved inputs whenever a route is opened.
  createEffect(() => {
    const route = activeRoute()
    generation++
    if (!route) return
    const saved = load(() => localStorage, inputsKey(route), emptyInputs(route))
    // Keep params in sync with the path even if the saved inputs are older.
    const params = Object.fromEntries(pathParams(route.path).map((p) => [p, saved.params[p] ?? '']))
    setInputs({ ...saved, params })
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
    if (route && current) save(() => localStorage, inputsKey(route), storableInputs(current))
  })
  // Write the environment where `remember` says, and clear the other storage so
  // switching the toggle moves it instead of leaving a copy behind.
  createEffect(() => {
    save(envStorage, DEFAULTS_KEY, defaults())
    save(envStorage, VARIABLES_KEY, variables())
    remove(otherStorage, DEFAULTS_KEY)
    remove(otherStorage, VARIABLES_KEY)
    save(() => localStorage, REMEMBER_KEY, remember())
  })
  createEffect(() => save(() => localStorage, SETTINGS_KEY, settings()))

  // Escape closes the sheet wherever focus is.
  createEffect(() => {
    if (!activeRoute()) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    onCleanup(() => document.removeEventListener('keydown', onKey))
  })

  const prepared = createMemo(() => {
    const route = activeRoute()
    const current = inputs()
    if (!route || !current) return null
    return prepareRequest({
      route,
      inputs: current,
      defaults: defaults(),
      variables: variableMap(variables()),
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
    try {
      const res = await fetch(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.body,
        credentials: 'same-origin',
      })
      const text = await res.text()
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
    } catch (err) {
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
    const { path, name } = capture()
    if (!res || !path.trim() || !name.trim()) return
    let json: unknown
    try {
      json = JSON.parse(res.raw)
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
    const rows = variables()
    setVariables(
      rows.some((r) => r.key === key)
        ? rows.map((r) => (r.key === key ? { ...r, value, enabled: true } : r))
        : [...rows, { key, value, enabled: true }],
    )
    setCaptureNote(`Saved {{${key}}}`)
  }

  const isPublic = () => {
    const route = activeRoute()
    return route ? isPublicRoute(route, settings()) : false
  }

  return (
    <Show when={activeRoute()}>
      {(route) => (
        <div
          class="fixed inset-0 z-50 bg-black/50"
          onClick={(e) => {
            if (e.target === e.currentTarget) close()
          }}
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={`Try ${route().method} ${route().path}`}
            class="absolute right-0 top-0 h-full w-full max-w-2xl bg-surface-1 border-l border-border-strong shadow-2xl flex flex-col"
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
                    {route().controller}.{route().handler}
                    <Show when={isPublic()}> · public route — default Authorization not sent</Show>
                  </p>
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
              <div class="font-mono text-xs bg-surface-2 border border-border rounded-lg px-3 py-2 mt-3 break-all text-text-secondary">
                {prepared()?.url}
              </div>
              <Show when={prepared() && unresolvedVariables(prepared()!).length > 0}>
                <p class="text-xs text-amber-400 mt-2">
                  No value for{' '}
                  {unresolvedVariables(prepared()!)
                    .map((v) => `{{${v}}}`)
                    .join(', ')}{' '}
                  — add it under Environment → Variables.
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
                      <RowsEditor rows={current().query} onChange={(query) => update({ query })} />
                    </Section>

                    <Section title="Headers" count={enabledCount(current().headers)}>
                      <RowsEditor
                        rows={current().headers}
                        onChange={(headers) => update({ headers })}
                      />
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

              <Section
                title="Environment"
                count={enabledCount(defaults()) + enabledCount(variables())}
              >
                <label class="flex items-start gap-2 text-sm mb-3">
                  <input
                    type="checkbox"
                    class="mt-1"
                    checked={remember()}
                    onChange={(e) => setRemember(e.currentTarget.checked)}
                  />
                  <span>
                    Remember on this browser
                    <span class="block text-xs text-text-muted">
                      {remember()
                        ? 'Default headers and variables are saved in localStorage and survive closing the tab. They may hold tokens — turn this off on a shared machine.'
                        : 'Default headers and variables are kept for this browser tab only.'}
                    </span>
                  </span>
                </label>

                <h3 class="text-xs font-semibold text-text-secondary mb-1">Default headers</h3>
                <p class="text-xs text-text-muted mb-2">
                  Sent with every route. A default Authorization is skipped on routes carrying a
                  public flag.
                </p>
                <RowsEditor rows={defaults()} onChange={setDefaults} />

                <h3 class="text-xs font-semibold text-text-secondary mt-4 mb-1">Variables</h3>
                <p class="text-xs text-text-muted mb-2">
                  Use <code>{'{{name}}'}</code> in any param, query, header or body value — e.g. a
                  default header <code>Authorization: Bearer {'{{token}}'}</code>. Fill them by hand
                  or with "Save to variable" on a response.
                </p>
                <RowsEditor rows={variables()} onChange={setVariables} />

                <h3 class="text-xs font-semibold text-text-secondary mt-4 mb-1">Settings</h3>
                <div class="flex flex-col sm:flex-row sm:items-end gap-3">
                  <label class="flex-1 flex flex-col gap-1 text-xs text-text-muted">
                    Public route flags (comma-separated)
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
                      ] as const
                    }
                  >
                    {([key, label]) => (
                      <label class="flex-1 flex flex-col gap-1 text-xs text-text-muted">
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
                        <span class={`font-bold ${statusColor(res().status)}`}>
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
            </div>

            {/* Footer actions */}
            <footer class="px-5 py-3 border-t border-border flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={sending()}
                onClick={send}
                class={`px-4 py-2 text-sm font-semibold rounded-lg border transition-colors ${
                  armed()
                    ? 'bg-red-500/20 text-red-400 border-red-500/40'
                    : 'bg-kick-500/20 text-kick-500 border-kick-500/30 hover:bg-kick-500/30'
                }`}
              >
                {sending()
                  ? 'Sending…'
                  : armed()
                    ? `Click again to send ${route().method.toUpperCase()}`
                    : 'Send'}
              </button>
            </footer>
          </aside>
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
}> = (props) => {
  const rows = () => [...props.rows, { key: '', value: '', enabled: true }]
  const set = (index: number, patch: Partial<KeyValueRow>) => {
    // Copy-on-write on purpose: mutating a row in place would not re-render it.
    // oxlint-disable-next-line no-map-spread
    const next = rows().map((row, i) => (i === index ? { ...row, ...patch } : row))
    props.onChange(next.filter((row) => row.key || row.value))
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
            <input
              class={inputClass}
              placeholder="name"
              value={row().key}
              onInput={(e) => set(i, { key: e.currentTarget.value })}
            />
            <input
              class={inputClass}
              placeholder="value"
              value={row().value}
              onInput={(e) => set(i, { value: e.currentTarget.value })}
            />
          </div>
        )}
      </Index>
    </div>
  )
}

const inputClass =
  'w-full min-w-0 bg-surface-2 border border-border-strong rounded-lg px-3 py-1.5 text-sm text-text-body placeholder:text-text-muted focus:outline-none focus:border-kick-500'
const secondaryButton =
  'px-3 py-2 text-xs font-semibold rounded-lg border bg-surface-2 text-text-secondary border-border-strong hover:text-text-body'

function statusColor(status: number): string {
  if (status >= 500) return 'text-red-400'
  if (status >= 400) return 'text-amber-400'
  if (status >= 300) return 'text-cyan-400'
  return 'text-emerald-400'
}
