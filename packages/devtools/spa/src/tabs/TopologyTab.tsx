import { createSignal, For, onMount, Show, type Component } from 'solid-js'
import type { IntrospectionSnapshot, TopologySnapshot } from '@forinda/kickjs-devtools-kit'
import { rpc } from '../lib/rpc'

export const TopologyTab: Component = () => {
  const [snapshot, setSnapshot] = createSignal<TopologySnapshot | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [refreshing, setRefreshing] = createSignal(false)

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    setError(null)
    try {
      setSnapshot(await rpc.topology())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRefreshing(false)
    }
  }

  onMount(() => {
    void refresh()
  })

  return (
    <>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h2 style="margin:0;font-size:16px">Topology</h2>
        <button
          type="button"
          class="tab"
          style="border:1px solid var(--border);border-radius:4px;padding:4px 12px;border-bottom-color:var(--border)"
          onClick={() => void refresh()}
          disabled={refreshing()}
        >
          {refreshing() ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <Show when={error()}>
        {(msg) => (
          <div class="card" style="border-color:var(--critical)">
            <div class="card-title" style="color:var(--critical)">
              Topology error
            </div>
            <code>{msg()}</code>
          </div>
        )}
      </Show>

      <Show when={snapshot()} fallback={<div class="empty">Loading topology…</div>}>
        {(snap) => (
          <>
            <Show when={snap().errors.length > 0}>
              <div class="card" style="border-color:var(--warn)">
                <div class="card-title" style="color:var(--warn)">
                  {snap().errors.length} introspect failure(s)
                </div>
                <ul style="margin:8px 0 0;padding-left:20px;font-family:var(--font-mono);font-size:12px">
                  <For each={snap().errors}>
                    {(err) => (
                      <li>
                        {err.kind}/{err.name}: {err.message}
                      </li>
                    )}
                  </For>
                </ul>
              </div>
            </Show>

            <Section
              title={`Plugins (${snap().plugins.length})`}
              items={snap().plugins}
              empty="No plugins registered"
            />
            <Section
              title={`Adapters (${snap().adapters.length})`}
              items={snap().adapters}
              empty="No adapters registered"
            />

            <div class="card">
              <div class="card-header">
                <div class="card-title">Contributors ({snap().contributors.length})</div>
              </div>
              <Show
                when={snap().contributors.length > 0}
                fallback={<div class="empty">No contributors registered</div>}
              >
                <table>
                  <thead>
                    <tr>
                      <th>Key</th>
                      <th>Source</th>
                      <th>Depends on</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={snap().contributors}>
                      {(c) => (
                        <tr>
                          <td>
                            <span class="tree-key">{c.key}</span>
                          </td>
                          <td>{c.source}</td>
                          <td>{c.dependsOn.join(', ') || '—'}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </Show>
            </div>

            <div class="card">
              <div class="card-header">
                <div class="card-title">DI tokens ({snap().diTokens.length})</div>
              </div>
              <Show
                when={snap().diTokens.length > 0}
                fallback={<div class="empty">No DI tokens registered</div>}
              >
                <table>
                  <thead>
                    <tr>
                      <th>Token</th>
                      <th>Scope</th>
                      <th>Kind</th>
                      <th>Resolved</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={snap().diTokens}>
                      {(t) => (
                        <tr>
                          <td>
                            <span class="tree-key">{t.token}</span>
                          </td>
                          <td>{t.scope}</td>
                          <td>{t.kind}</td>
                          <td>{t.instantiated ? 'yes' : 'no'}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </Show>
            </div>
          </>
        )}
      </Show>
    </>
  )
}

const Section: Component<{
  title: string
  items: IntrospectionSnapshot[]
  empty: string
}> = (props) => (
  <div class="card">
    <div class="card-header">
      <div class="card-title">{props.title}</div>
    </div>
    <Show when={props.items.length > 0} fallback={<div class="empty">{props.empty}</div>}>
      <For each={props.items}>{(item) => <PrimitiveRow item={item} />}</For>
    </Show>
  </div>
)

const PrimitiveRow: Component<{ item: IntrospectionSnapshot }> = (props) => (
  <div class="tree-node">
    <span class="tree-key">{props.item.name}</span>
    <Show when={props.item.version}>
      <span class="tree-meta">v{props.item.version}</span>
    </Show>
    <Show when={props.item.tokens?.provides.length}>
      <div class="tree-meta">provides: {props.item.tokens?.provides.join(', ')}</div>
    </Show>
    <Show when={props.item.metrics}>
      {(m) => (
        <div class="tree-meta">
          <For each={Object.entries(m())}>
            {([key, value]) => (
              <span style="margin-right:12px">
                {key}: <strong style="color:var(--text)">{value}</strong>
              </span>
            )}
          </For>
        </div>
      )}
    </Show>
  </div>
)
