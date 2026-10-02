import { createSignal, For, onCleanup, onMount, Show, type Component } from 'solid-js'
import type { DevtoolsTabDescriptor, DevtoolsTabView } from '@forinda/kickjs-devtools-kit'
import type { DevtoolsRenderTab, TabProps } from '@forinda/kickjs-devtools-kit'
import { getBasePath, getToken } from '../lib/rpc'
import { getBus } from '../lib/bus'
import { resolvedTheme } from '../lib/theme'

/**
 * Renders one custom tab contributed by an adapter or plugin via
 * `devtoolsTabs()`. Four view types are supported:
 *
 * - **iframe** — embedded URL with sandboxed cross-origin policy.
 *   `allow-scripts allow-same-origin` is required because the iframe
 *   target is on the same KickJS server as the panel and needs to
 *   resolve cookies + relative URLs. We deliberately don't grant
 *   `allow-top-navigation` so a misbehaving plugin can't navigate
 *   the parent panel.
 * - **launch** — declarative button list. Each button POSTs to
 *   `/tabs/run`, which calls the action's `run()` on the server.
 * - **module** — a same-origin ES module whose default export renders
 *   into the tab (`defineDevtoolsRenderTab` or a bare `render` function).
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
      <Show when={props.tab.view.type === 'module'}>
        <ModuleView view={props.tab.view as Extract<DevtoolsTabView, { type: 'module' }>} />
      </Show>
      <Show when={props.tab.view.type === 'html'}>
        <HtmlView view={props.tab.view as Extract<DevtoolsTabView, { type: 'html' }>} />
      </Show>
    </div>
  )
}

const IframeView: Component<{ view: Extract<DevtoolsTabView, { type: 'iframe' }> }> = (props) => {
  const src = (): string => {
    // Relative srcs resolve against the dashboard page. The token rides along
    // only to the app's own origin, so the iframe shares the dashboard's auth;
    // a panel hosted elsewhere never sees it.
    const url = new URL(props.view.src, location.href)
    const token = getToken()
    if (token && url.origin === location.origin) url.searchParams.set('token', token)
    return url.href
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
      const query = new URLSearchParams({ tab: props.tabId, action: actionId })
      const token = getToken()
      if (token) query.set('token', token)
      const res = await fetch(`${getBasePath()}/tabs/run?${query}`, {
        method: 'POST',
        headers: token ? { 'x-devtools-token': token } : undefined,
      })
      const body = (await res.json().catch(() => ({}))) as { result?: unknown; error?: string }
      setResult(
        res.ok
          ? JSON.stringify(body.result, null, 2)
          : `${res.status} — ${body.error ?? res.statusText}`,
      )
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
            <pre class="m-0 font-mono text-xs whitespace-pre-wrap">{r()}</pre>
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

const ModuleView: Component<{ view: Extract<DevtoolsTabView, { type: 'module' }> }> = (props) => {
  let el: HTMLDivElement | undefined
  const [error, setError] = createSignal<string | null>(null)
  let cleanup: void | (() => void)
  let disposed = false

  onMount(async () => {
    // The module runs with the dashboard's privileges (it can read the
    // token), so only the app's own origin may supply one.
    const url = new URL(props.view.src, location.href)
    if (url.origin !== location.origin) {
      setError(`Refusing to load a tab module from another origin: ${url.origin}`)
      return
    }
    const bus = getBus()
    if (!bus) {
      setError('The event bus is not ready yet — reopen the tab.')
      return
    }
    try {
      const mod = (await import(/* @vite-ignore */ url.href)) as {
        default?: DevtoolsRenderTab | DevtoolsRenderTab['render']
      }
      const render = typeof mod.default === 'function' ? mod.default : mod.default?.render
      if (typeof render !== 'function') {
        setError(`${url.pathname} has no default export with a render function`)
        return
      }
      if (disposed || !el) return
      const tabProps: TabProps = {
        bus,
        config: { theme: resolvedTheme(), panelHeight: el.clientHeight },
        query: new URLSearchParams(location.search),
      }
      cleanup = render(el, tabProps)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  })
  onCleanup(() => {
    disposed = true
    if (typeof cleanup === 'function') cleanup()
  })

  return (
    <>
      <Show when={error()}>
        <div class="card m-4 text-red-500">{error()}</div>
      </Show>
      <div ref={(e) => (el = e)} class="min-h-0 flex-1 overflow-auto" />
    </>
  )
}
