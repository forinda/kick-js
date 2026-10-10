/**
 * Sockets — the app's WebSocket namespaces (from `WsAdapter`) with their open
 * connections and `@OnMessage` events, and a client to try one: connect, send
 * `{ event, data }`, and watch what comes back. The query string takes
 * `{{variables}}` from the API runner's active environment, so a token a
 * login route saved can authenticate the socket.
 *
 * Per namespace, the query, event and data are remembered in this browser.
 */

import { createSignal, For, onCleanup, onMount, Show, type Component } from 'solid-js'
import { rpc } from '../lib/rpc'
import { store, storeActions } from '../lib/store'
import { SplitPane } from '../lib/split-pane'
import { activeEnvironmentVariables } from '../lib/api-runner'
import { formatJson, interpolate } from '../lib/api-runner-core'

const MAX_LOG = 200
const inputKey = (path: string) => `kickjs-devtools:sockets:${path}`

interface SocketInputs {
  query: string
  event: string
  data: string
}
interface LogEntry {
  id: number
  dir: 'out' | 'in' | 'info'
  at: number
  text: string
}

function loadInputs(path: string): SocketInputs {
  try {
    const raw = JSON.parse(localStorage.getItem(inputKey(path)) ?? '{}') as Partial<SocketInputs>
    return {
      query: typeof raw.query === 'string' ? raw.query : '',
      event: typeof raw.event === 'string' ? raw.event : '',
      data: typeof raw.data === 'string' ? raw.data : '',
    }
  } catch {
    return { query: '', event: '', data: '' }
  }
}

const inputClass =
  'w-full min-w-0 bg-surface-2 border border-border-strong rounded-lg px-3 py-1.5 text-sm text-text-body placeholder:text-text-muted focus:outline-none focus:border-kick-500'
const button =
  'shrink-0 px-3 py-1.5 text-xs font-semibold rounded-lg border bg-surface-2 text-text-secondary border-border-strong hover:text-text-body disabled:cursor-not-allowed disabled:opacity-50'

export const SocketsTab: Component = () => {
  const [selected, setSelected] = createSignal<string | null>(null)
  const namespaces = () =>
    Object.entries(store.ws().namespaces ?? {}).toSorted(([a], [b]) => a.localeCompare(b))

  const refresh = async (): Promise<void> => {
    try {
      storeActions.setWs(await rpc.ws())
    } catch {
      // keep the last stats
    }
  }
  onMount(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 2000)
    onCleanup(() => clearInterval(timer))
  })

  const list = (
    <div class="min-h-0 flex-1 overflow-y-auto">
      <Show
        when={store.ws().enabled}
        fallback={
          <div class="empty">
            No <code>WsAdapter</code> — add one from <code>@forinda/kickjs-ws</code> to see its
            namespaces here.
          </div>
        }
      >
        <Show when={namespaces().length} fallback={<div class="empty">No namespaces yet</div>}>
          <For each={namespaces()}>
            {([path, ns]) => (
              <button
                type="button"
                onClick={() => setSelected(path)}
                class={`flex w-full flex-col gap-1 border-0 border-b border-border/50 px-2.5 py-1.5 text-left text-[0.78rem] ${
                  selected() === path
                    ? 'bg-accent/12 shadow-[inset_2px_0_0_0_var(--color-accent)]'
                    : 'bg-transparent hover:bg-surface-hover'
                }`}
              >
                <span class="flex items-center gap-2">
                  <span class="min-w-0 flex-1 truncate font-mono text-text-body">{path}</span>
                  <span class="text-[0.7rem] text-text-muted tabular-nums">
                    {ns.connections} open
                  </span>
                </span>
                <Show when={ns.events?.length}>
                  <span class="flex flex-wrap gap-1">
                    <For each={ns.events}>
                      {(e) => (
                        <span class="rounded border border-border px-1.5 font-mono text-[0.66rem] text-text-secondary">
                          {e}
                        </span>
                      )}
                    </For>
                  </span>
                </Show>
              </button>
            )}
          </For>
        </Show>
      </Show>
    </div>
  )

  const detail = (
    <Show
      when={selected()}
      keyed
      fallback={
        <div class="dt-panel-grid">
          <div class="card text-sm text-text-muted">Select a namespace to connect to it</div>
        </div>
      }
    >
      {(path) => <SocketClient path={path} events={store.ws().namespaces?.[path]?.events ?? []} />}
    </Show>
  )

  return (
    <SplitPane
      storageKey="sockets"
      left={
        <>
          <div class="border-b border-border p-2 text-xs text-text-muted">
            <Show when={store.ws().enabled}>
              {namespaces().length} namespaces · {store.ws().activeConnections ?? 0} open ·{' '}
              {(store.ws().messagesReceived ?? 0) + (store.ws().messagesSent ?? 0)} messages
            </Show>
          </div>
          {list}
        </>
      }
      right={detail}
    />
  )
}

/** A client for one namespace. Keyed by path: switching namespace closes the socket. */
const SocketClient: Component<{ path: string; events: string[] }> = (props) => {
  const [inputs, setInputs] = createSignal<SocketInputs>(loadInputs(props.path))
  const [state, setState] = createSignal<'closed' | 'connecting' | 'open'>('closed')
  const [log, setLog] = createSignal<LogEntry[]>([])
  const [dataError, setDataError] = createSignal<string | null>(null)
  let socket: WebSocket | null = null
  let seq = 0
  let logEl: HTMLDivElement | undefined

  const update = (patch: Partial<SocketInputs>): void => {
    const next = { ...inputs(), ...patch }
    setInputs(next)
    try {
      localStorage.setItem(inputKey(props.path), JSON.stringify(next))
    } catch {
      // storage unavailable — kept for this visit
    }
  }
  const push = (dir: LogEntry['dir'], text: string): void => {
    setLog((l) => [...l, { id: seq++, dir, at: Date.now(), text }].slice(-MAX_LOG))
    queueMicrotask(() => logEl?.scrollTo({ top: logEl.scrollHeight }))
  }

  const url = (): string => {
    const q = interpolate(inputs().query.trim().replace(/^\?/, ''), activeEnvironmentVariables())
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    return `${proto}://${location.host}${props.path}${q ? `?${q}` : ''}`
  }

  const connect = (): void => {
    if (socket) return
    const target = url()
    setState('connecting')
    push('info', `Connecting to ${props.path}…`)
    const ws = new WebSocket(target)
    socket = ws
    ws.addEventListener('open', () => {
      setState('open')
      push('info', 'Connected')
    })
    ws.addEventListener('message', (e) =>
      push('in', typeof e.data === 'string' ? e.data : '(binary frame)'),
    )
    ws.addEventListener('error', () => push('info', 'Socket error — see the close reason below'))
    ws.addEventListener('close', (e) => {
      if (socket === ws) socket = null
      setState('closed')
      push('info', `Closed (${e.code}${e.reason ? `: ${e.reason}` : ''})`)
    })
  }
  const disconnect = (): void => socket?.close(1000, 'closed from DevTools')
  onCleanup(() => socket?.close(1000, 'closed from DevTools'))

  const send = (): void => {
    if (!socket || state() !== 'open') return
    const raw = interpolate(inputs().data.trim(), activeEnvironmentVariables())
    let data: unknown
    if (raw) {
      try {
        data = JSON.parse(raw)
      } catch {
        setDataError('Data is not valid JSON')
        return
      }
    }
    setDataError(null)
    const frame = JSON.stringify(
      data === undefined ? { event: inputs().event } : { event: inputs().event, data },
    )
    socket.send(frame)
    push('out', frame)
  }

  const pretty = (text: string): string => formatJson(text) ?? text

  return (
    <div class="flex h-full flex-col gap-3 overflow-hidden p-3 text-sm">
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <span class="font-mono text-text-strong">{props.path}</span>
          <span
            class={`text-xs ${
              state() === 'open'
                ? 'text-emerald-500'
                : state() === 'connecting'
                  ? 'text-amber-500'
                  : 'text-text-muted'
            }`}
          >
            ● {state()}
          </span>
        </div>
        <div class="flex items-center gap-2">
          <input
            class={inputClass}
            aria-label="Query string"
            placeholder="query, e.g. token={{token}}"
            value={inputs().query}
            disabled={state() !== 'closed'}
            onInput={(e) => update({ query: e.currentTarget.value })}
          />
          <Show
            when={state() === 'closed'}
            fallback={
              <button type="button" class={button} onClick={disconnect}>
                Disconnect
              </button>
            }
          >
            <button type="button" class={button} onClick={connect}>
              Connect
            </button>
          </Show>
        </div>
        <p class="text-xs text-text-muted">
          <code>{'{{variables}}'}</code> come from the API runner's active environment. Browsers
          can't set headers on a WebSocket, so pass a token in the query or rely on cookies.
        </p>
      </div>

      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <input
            class={inputClass}
            aria-label="Event"
            list={`events-${props.path}`}
            placeholder={props.events.length ? `event, e.g. ${props.events[0]}` : 'event name'}
            value={inputs().event}
            onInput={(e) => update({ event: e.currentTarget.value })}
          />
          <datalist id={`events-${props.path}`}>
            <For each={props.events}>{(e) => <option value={e} />}</For>
          </datalist>
          <button
            type="button"
            class={button}
            disabled={state() !== 'open' || !inputs().event.trim()}
            title={state() === 'open' ? 'Send { event, data }' : 'Connect first'}
            onClick={send}
          >
            Send
          </button>
        </div>
        <textarea
          class={`${inputClass} h-24 font-mono text-xs`}
          aria-label="Data (JSON)"
          placeholder={'data as JSON, e.g. { "channelId": "{{channelId}}" } — optional'}
          spellcheck={false}
          value={inputs().data}
          onInput={(e) => update({ data: e.currentTarget.value })}
        />
        <Show when={dataError()}>
          <p class="text-xs text-red-500">{dataError()}</p>
        </Show>
      </div>

      <div class="flex min-h-0 flex-1 flex-col">
        <div class="mb-1 flex items-center gap-2 text-xs text-text-muted">
          <span class="flex-1">Messages ({log().length})</span>
          <button type="button" class="underline hover:text-text-body" onClick={() => setLog([])}>
            Clear
          </button>
        </div>
        <div
          ref={(el) => (logEl = el)}
          class="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-surface-2 p-2 font-mono text-xs"
        >
          <Show when={log().length} fallback={<span class="text-text-muted">Nothing yet.</span>}>
            <For each={log()}>
              {(entry) => (
                <div class="flex gap-2 border-b border-border/40 py-1 last:border-0">
                  <span
                    class={`w-4 shrink-0 ${
                      entry.dir === 'out'
                        ? 'text-blue-500'
                        : entry.dir === 'in'
                          ? 'text-emerald-500'
                          : 'text-text-muted'
                    }`}
                    title={entry.dir === 'out' ? 'sent' : entry.dir === 'in' ? 'received' : ''}
                  >
                    {entry.dir === 'out' ? '↑' : entry.dir === 'in' ? '↓' : '·'}
                  </span>
                  <span class="shrink-0 text-text-muted">
                    {new Date(entry.at).toLocaleTimeString()}
                  </span>
                  <pre
                    class={`m-0 min-w-0 flex-1 whitespace-pre-wrap break-all ${
                      entry.dir === 'info' ? 'text-text-muted' : 'text-text-body'
                    }`}
                  >
                    {entry.dir === 'info' ? entry.text : pretty(entry.text)}
                  </pre>
                </div>
              )}
            </For>
          </Show>
        </div>
      </div>
    </div>
  )
}
