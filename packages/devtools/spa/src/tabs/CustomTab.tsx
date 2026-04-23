import { createSignal, For, Show, type Component } from 'solid-js'
import type { DevtoolsTabDescriptor, DevtoolsTabView } from '@forinda/kickjs-devtools-kit'
import { getBasePath, getToken } from '../lib/rpc'

/**
 * Renders one custom tab contributed by an adapter or plugin via
 * `devtoolsTabs()`. Three view types are supported:
 *
 * - **iframe** — embedded URL with sandboxed cross-origin policy.
 *   `allow-scripts allow-same-origin` is required because the iframe
 *   target is on the same KickJS server as the panel and needs to
 *   resolve cookies + relative URLs. We deliberately don't grant
 *   `allow-top-navigation` so a misbehaving plugin can't navigate
 *   the parent panel.
 * - **launch** — declarative button list. Each button POSTs to its
 *   handler URL (or fires an empty post — adapter author wires the
 *   route).
 * - **html** — inline HTML snippet rendered into a div. Trust-boundary:
 *   the HTML comes from a first-party adapter (we control its
 *   shape via `defineAdapter`), so XSS risk is limited to misuse by
 *   the adapter author rather than a hostile third party.
 */
export const CustomTab: Component<{ tab: DevtoolsTabDescriptor }> = (props) => {
  return (
    <div style="display:flex;flex-direction:column;height:100%">
      <Show when={props.tab.view.type === 'iframe'}>
        <IframeView view={props.tab.view as Extract<DevtoolsTabView, { type: 'iframe' }>} />
      </Show>
      <Show when={props.tab.view.type === 'launch'}>
        <LaunchView
          view={props.tab.view as Extract<DevtoolsTabView, { type: 'launch' }>}
          tabId={props.tab.id}
        />
      </Show>
      <Show when={props.tab.view.type === 'html'}>
        <HtmlView view={props.tab.view as Extract<DevtoolsTabView, { type: 'html' }>} />
      </Show>
    </div>
  )
}

const IframeView: Component<{ view: Extract<DevtoolsTabView, { type: 'iframe' }> }> = (props) => {
  const src = (): string => {
    // If src is a relative path, resolve it against the base path so a
    // panel mounted at /_debug + an adapter serving its panel at
    // /_kick/queue/panel just works without the adapter author having
    // to compute a leading slash. Token propagates as a query param
    // so the iframe inherits the dashboard's auth context.
    const raw = props.view.src
    const url = raw.startsWith('http') || raw.startsWith('//') ? raw : raw
    const token = getToken()
    if (!token) return url
    const sep = url.includes('?') ? '&' : '?'
    return `${url}${sep}token=${encodeURIComponent(token)}`
  }
  return (
    <iframe
      title="custom devtools tab"
      src={src()}
      sandbox="allow-scripts allow-same-origin allow-forms"
      style="flex:1;width:100%;border:none;background:var(--bg)"
    />
  )
}

const LaunchView: Component<{
  view: Extract<DevtoolsTabView, { type: 'launch' }>
  tabId: string
}> = (props) => {
  const [pending, setPending] = createSignal<string | null>(null)
  const [result, setResult] = createSignal<string | null>(null)

  const dispatch = async (actionId: string): Promise<void> => {
    setPending(actionId)
    setResult(null)
    try {
      const url = `${getBasePath()}/tabs/${encodeURIComponent(props.tabId)}/actions/${encodeURIComponent(actionId)}`
      const token = getToken()
      const res = await fetch(token ? `${url}?token=${encodeURIComponent(token)}` : url, {
        method: 'POST',
        headers: token ? { 'x-devtools-token': token } : undefined,
      })
      setResult(`${res.status} ${res.statusText}`)
    } catch (err) {
      setResult(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(null)
    }
  }

  return (
    <div style="padding:16px">
      <div class="card">
        <For each={props.view.actions}>
          {(action) => (
            <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
              <div>
                <div style="font-weight:600">{action.label}</div>
                <Show when={action.description}>
                  <div style="color:var(--text-dim);font-size:12px">{action.description}</div>
                </Show>
              </div>
              <button
                type="button"
                class="tab"
                style="border:1px solid var(--border);border-radius:4px;padding:6px 14px;border-bottom-color:var(--border)"
                disabled={pending() === action.id}
                onClick={() => void dispatch(action.id)}
              >
                {pending() === action.id ? 'Running…' : 'Run'}
              </button>
            </div>
          )}
        </For>
      </div>
      <Show when={result()}>
        {(r) => (
          <div class="card">
            <div class="card-title">Last response</div>
            <code>{r()}</code>
          </div>
        )}
      </Show>
    </div>
  )
}

const HtmlView: Component<{ view: Extract<DevtoolsTabView, { type: 'html' }> }> = (props) => (
  <div
    style="padding:16px;flex:1;overflow:auto"
    // Trust boundary documented on CustomTab: the HTML comes from a
    // first-party adapter author who controls the panel's contract,
    // not arbitrary user input. Static panels (status pages, simple
    // info widgets) are the intended use case.
    // eslint-disable-next-line solid/no-innerhtml
    innerHTML={props.view.html}
  />
)
