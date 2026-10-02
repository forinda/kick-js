/**
 * Topology — what's plugged into the app: plugins, adapters and context
 * contributors side by side. Each plugin / adapter card shows its version,
 * the state and counters its `introspect()` reports, and the DI tokens it
 * provides and requires; hovering a token highlights every card that
 * provides or requires it, and clicking one opens it in Container.
 *
 * Fetches `/_debug/topology` on open and every 5s.
 */

import { createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from 'solid-js'
import type {
  IntrospectionSnapshot,
  TopologyContributorEntry,
  TopologySnapshot,
} from '@forinda/kickjs-devtools-kit'
import { rpc } from '../lib/rpc'
import { ago } from '../lib/format'
import { openToken } from '../lib/token-detail'

export const TopologyTab: Component = () => {
  const [snap, setSnap] = createSignal<TopologySnapshot | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  /** The token or contributor key under the pointer — matching cards light up. */
  const [hover, setHover] = createSignal<string | null>(null)

  const refresh = async (): Promise<void> => {
    try {
      setSnap(await rpc.topology())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  onMount(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 5000)
    onCleanup(() => clearInterval(timer))
  })

  const touches = (p: IntrospectionSnapshot, token: string | null): boolean =>
    !!token && (!!p.tokens?.provides.includes(token) || !!p.tokens?.requires.includes(token))

  return (
    <div class="flex flex-col gap-3">
      <div class="flex items-center gap-3 text-xs text-text-muted">
        <Show when={snap()}>
          {(s) => (
            <span>
              {s().plugins.length} plugins · {s().adapters.length} adapters ·{' '}
              {s().contributors.length} contributors · updated {ago(s().timestamp)}
            </span>
          )}
        </Show>
        <span class="flex-1" />
        <button
          type="button"
          class="rounded-md border border-border-strong bg-surface-2 px-2.5 py-1 text-xs text-text-secondary hover:text-text-strong"
          onClick={() => void refresh()}
        >
          Refresh
        </button>
      </div>

      <Show when={error()}>
        <div class="card text-sm text-red-500">{error()}</div>
      </Show>
      <Show when={snap()?.errors.length}>
        <div class="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm">
          <For each={snap()!.errors}>
            {(e) => (
              <div>
                <span class="font-semibold text-red-500">
                  {e.name} ({e.kind}) introspect() failed:
                </span>{' '}
                {e.message}
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={snap()} fallback={<div class="empty">Loading topology…</div>}>
        {(s) => (
          <div class="grid grid-cols-1 items-start gap-3 lg:grid-cols-3">
            <Lane
              title="Plugins"
              count={s().plugins.length}
              empty="No plugins — definePlugin(...) adds one."
            >
              <For each={s().plugins}>
                {(p) => (
                  <PrimitiveCard
                    p={p}
                    lit={touches(p, hover())}
                    hover={hover()}
                    onHover={setHover}
                  />
                )}
              </For>
            </Lane>
            <Lane title="Adapters" count={s().adapters.length} empty="No adapters registered.">
              <For each={s().adapters}>
                {(p) => (
                  <PrimitiveCard
                    p={p}
                    lit={touches(p, hover())}
                    hover={hover()}
                    onHover={setHover}
                  />
                )}
              </For>
            </Lane>
            <Lane
              title="Contributors"
              count={s().contributors.length}
              empty="No context contributors — defineContextDecorator(...) adds one."
            >
              <For each={s().contributors}>
                {(c) => <ContributorRow c={c} hover={hover()} onHover={setHover} />}
              </For>
            </Lane>
          </div>
        )}
      </Show>
    </div>
  )
}

const Lane: Component<{ title: string; count: number; empty: string; children: unknown }> = (
  props,
) => (
  <section class="flex flex-col gap-2">
    <h2 class="text-[0.66rem] font-semibold uppercase tracking-wider text-text-muted">
      {props.title} <span class="font-normal">({props.count})</span>
    </h2>
    <Show
      when={props.count > 0}
      fallback={
        <div class="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-text-muted">
          {props.empty}
        </div>
      }
    >
      {props.children as Element}
    </Show>
  </section>
)

const PrimitiveCard: Component<{
  p: IntrospectionSnapshot
  lit: boolean
  hover: string | null
  onHover: (t: string | null) => void
}> = (props) => {
  const state = createMemo(() => Object.entries(props.p.state ?? {}))
  const metrics = createMemo(() => Object.entries(props.p.metrics ?? {}))
  const reports = () =>
    state().length +
      metrics().length +
      (props.p.tokens?.provides.length ?? 0) +
      (props.p.tokens?.requires.length ?? 0) >
    0

  return (
    <article
      class={`rounded-lg border bg-surface-1 px-3 py-2 text-[0.78rem] transition-colors ${
        props.lit ? 'border-kick-500 shadow-[0_0_0_1px_var(--color-accent)]' : 'border-border'
      }`}
    >
      <header class="flex items-center gap-2">
        <span class="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate font-mono font-semibold text-text-strong">
          {props.p.name}
        </span>
        <Show when={props.p.version}>
          <span class="dt-tone dt-tone-gray">v{props.p.version}</span>
        </Show>
      </header>
      <Show when={metrics().length}>
        <div class="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
          <For each={metrics()}>
            {([k, v]) => (
              <span class="text-text-muted">
                {k}{' '}
                <span class="font-semibold text-text-body tabular-nums">{v.toLocaleString()}</span>
              </span>
            )}
          </For>
        </div>
      </Show>
      <Show when={state().length}>
        <dl class="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          <For each={state()}>
            {([k, v]) => (
              <>
                <dt class="text-text-muted">{k}</dt>
                <dd class="m-0 truncate font-mono" title={JSON.stringify(v)}>
                  {typeof v === 'string' ? v : JSON.stringify(v)}
                </dd>
              </>
            )}
          </For>
        </dl>
      </Show>
      <TokenChips
        label="provides"
        tokens={props.p.tokens?.provides ?? []}
        hover={props.hover}
        onHover={props.onHover}
      />
      <TokenChips
        label="requires"
        tokens={props.p.tokens?.requires ?? []}
        hover={props.hover}
        onHover={props.onHover}
      />
      <Show when={!reports()}>
        <p class="mt-1 text-xs text-text-muted">Reports nothing — it has no introspect().</p>
      </Show>
    </article>
  )
}

const TokenChips: Component<{
  label: string
  tokens: readonly string[]
  hover: string | null
  onHover: (t: string | null) => void
}> = (props) => (
  <Show when={props.tokens.length}>
    <div class="mt-1.5 flex flex-wrap items-center gap-1">
      <span class="w-14 text-[0.66rem] text-text-muted">{props.label}</span>
      <For each={props.tokens}>
        {(t) => (
          <button
            type="button"
            class={`rounded border px-1.5 font-mono text-[0.68rem] ${
              props.hover === t
                ? 'border-kick-500 text-kick-500'
                : 'border-border-strong text-text-secondary hover:text-text-strong'
            }`}
            onMouseEnter={() => props.onHover(t)}
            onMouseLeave={() => props.onHover(null)}
            onClick={() => openToken(t)}
            title="Open in Container"
          >
            {t}
          </button>
        )}
      </For>
    </div>
  </Show>
)

const ContributorRow: Component<{
  c: TopologyContributorEntry
  hover: string | null
  onHover: (k: string | null) => void
}> = (props) => (
  <article
    class={`rounded-lg border bg-surface-1 px-3 py-1.5 text-[0.78rem] ${
      props.hover === props.c.key ? 'border-kick-500' : 'border-border'
    }`}
    onMouseEnter={() => props.onHover(props.c.key)}
    onMouseLeave={() => props.onHover(null)}
  >
    <div class="flex items-center gap-2">
      <span class="min-w-0 flex-1 truncate font-mono font-semibold">ctx.{props.c.key}</span>
      <span class="dt-tone dt-tone-gray">{props.c.source}</span>
    </div>
    <Show when={props.c.dependsOn.length}>
      <div class="mt-1 flex flex-wrap items-center gap-1 text-[0.68rem] text-text-muted">
        after
        <For each={props.c.dependsOn}>
          {(d) => (
            <span
              class={`rounded border px-1.5 font-mono ${props.hover === d ? 'border-kick-500 text-kick-500' : 'border-border-strong'}`}
            >
              {d}
            </span>
          )}
        </For>
      </div>
    </Show>
  </article>
)
