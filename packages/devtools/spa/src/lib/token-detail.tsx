/**
 * Everything known about one DI token: kind, scope and status; what it
 * depends on and what depends on it (each a link to that token); resolve
 * stats; `@PostConstruct` outcome. Shown beside the Container list and the
 * Graph.
 */
import { createMemo, For, Show, type Component } from 'solid-js'
import { store, type ContainerRegistration } from './store'
import { formatMs, kindTone, severityTone } from './format'
import { switchTab } from './nav'
import { InfoTip } from './info'

/** The token the Container tab shows — set from anywhere to open it there. */
let pendingToken: string | null = null

/** Show the Container tab with `token` selected. */
export function openToken(token: string): void {
  pendingToken = token
  switchTab('container')
}

/** Read (and clear) the token to select when the Container tab mounts. */
export function takePendingToken(): string | null {
  const t = pendingToken
  pendingToken = null
  return t
}

export function tokenStatus(r: ContainerRegistration): { label: string; tone: string } {
  if (r.postConstructStatus === 'failed') return { label: 'failed', tone: severityTone('err') }
  if (r.instantiated) return { label: 'active', tone: severityTone('ok') }
  return { label: 'registered', tone: severityTone('idle') }
}

export const TokenDetail: Component<{ token: string; onSelect: (token: string) => void }> = (
  props,
) => {
  const reg = createMemo(() => store.container().find((r) => r.token === props.token))
  const dependents = createMemo(() =>
    store
      .container()
      .filter((r) => r.dependencies?.includes(props.token))
      .map((r) => r.token),
  )

  const links = (tokens: readonly string[]) => (
    <Show when={tokens.length} fallback={<span class="text-xs text-text-muted">None</span>}>
      <div class="flex flex-wrap gap-1">
        <For each={tokens}>
          {(t) => (
            <button
              type="button"
              class="rounded border border-border-strong bg-surface-2 px-2 py-0.5 font-mono text-xs text-text-body hover:border-kick-500 hover:text-kick-500"
              onClick={() => props.onSelect(t)}
            >
              {t}
            </button>
          )}
        </For>
      </div>
    </Show>
  )

  return (
    <Show
      when={reg()}
      fallback={
        <div class="p-4 text-sm text-text-muted">{props.token} is no longer registered.</div>
      }
    >
      {(r) => (
        <section class="flex flex-col gap-4 p-4 text-[0.8rem]">
          <header>
            <h2 class="m-0 break-all font-mono text-base text-text-strong">{r().token}</h2>
            <div class="mt-1.5 flex flex-wrap gap-1.5">
              <span class={kindTone(r().kind)}>{r().kind ?? 'unknown'}</span>
              <span class="dt-tone dt-tone-gray">{r().scope ?? 'singleton'}</span>
              <span class={tokenStatus(r()).tone}>{tokenStatus(r()).label}</span>
            </div>
          </header>
          <Block title={`Depends on (${r().dependencies?.length ?? 0})`}>
            {links(r().dependencies ?? [])}
          </Block>
          <Block title={`Used by (${dependents().length})`}>{links(dependents())}</Block>
          <Block title="Resolution">
            <dl class="grid grid-cols-[9rem_1fr] gap-y-1">
              <dt class="text-text-muted">
                Resolves <InfoTip metric="resolve.count" />
              </dt>
              <dd class="m-0 tabular-nums">{r().resolveCount ?? 0}</dd>
              <Show when={r().firstResolvedAt}>
                <dt class="text-text-muted">First</dt>
                <dd class="m-0">{new Date(r().firstResolvedAt!).toLocaleTimeString()}</dd>
              </Show>
              <Show when={r().lastResolvedAt}>
                <dt class="text-text-muted">Last</dt>
                <dd class="m-0">{new Date(r().lastResolvedAt!).toLocaleTimeString()}</dd>
              </Show>
              <Show when={r().resolveDurationMs != null}>
                <dt class="text-text-muted">
                  Took <InfoTip metric="resolve.duration" />
                </dt>
                <dd class="m-0 tabular-nums">{formatMs(r().resolveDurationMs!)}</dd>
              </Show>
              <dt class="text-text-muted">
                @PostConstruct <InfoTip metric="post-construct" />
              </dt>
              <dd class="m-0">
                <span
                  class={severityTone(
                    r().postConstructStatus === 'failed'
                      ? 'err'
                      : r().postConstructStatus === 'done'
                        ? 'ok'
                        : 'idle',
                  )}
                >
                  {r().postConstructStatus ?? 'none'}
                </span>
              </dd>
            </dl>
          </Block>
        </section>
      )}
    </Show>
  )
}

const Block: Component<{ title: string; children: unknown }> = (props) => (
  <div>
    <h3 class="mb-1.5 text-[0.66rem] font-semibold uppercase tracking-wider text-text-muted">
      {props.title}
    </h3>
    {props.children as Element}
  </div>
)
