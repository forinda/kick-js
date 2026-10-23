/**
 * Config — where each variable the app declares gets its value: set in the
 * environment, read from a `<NAME>_FILE`, the schema's default, `provide()`,
 * or not set at all. The env schema first, then each settings section in the
 * order the app bound it. Names only; values never leave the server here.
 * Each group collapses; collapsed groups are remembered.
 *
 * Fetches `/_debug/config/origins` on open.
 */

import { createMemo, createSignal, For, onMount, Show, type Component } from 'solid-js'
import { rpc, type ConfigOrigins, type ValueOrigin } from '../lib/rpc'

const LABEL: Record<ValueOrigin, string> = {
  env: 'env',
  file: '_FILE',
  provided: 'provided',
  default: 'default',
  unset: 'unset',
}

const COLLAPSED_KEY = 'kickjs-devtools:config:collapsed'

function loadCollapsed(): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]')
    return new Set(Array.isArray(raw) ? raw.filter((c) => typeof c === 'string') : [])
  } catch {
    return new Set()
  }
}

const TONE: Record<ValueOrigin, string> = {
  env: 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400',
  file: 'border-sky-500/40 text-sky-600 dark:text-sky-400',
  provided: 'border-violet-500/40 text-violet-600 dark:text-violet-400',
  default: 'border-border-strong text-text-muted',
  unset: 'border-amber-500/50 text-amber-600 dark:text-amber-400',
}

export const ConfigTab: Component = () => {
  const [origins, setOrigins] = createSignal<ConfigOrigins | null>(null)
  const [error, setError] = createSignal<string | null>(null)

  const refresh = async (): Promise<void> => {
    try {
      setOrigins(await rpc.configOrigins())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  onMount(() => void refresh())

  const groups = createMemo(() => {
    const o = origins()
    if (!o) return []
    return [
      { title: 'Env schema', vars: o.env },
      ...o.sections.map((s) => ({ title: `${s.prefix} settings`, vars: s.vars })),
    ].filter((g) => g.vars.length > 0)
  })
  const unset = createMemo(
    () =>
      groups()
        .flatMap((g) => g.vars)
        .filter((v) => v.origin === 'unset').length,
  )

  const [collapsed, setCollapsed] = createSignal(loadCollapsed())
  const setAll = (next: Set<string>) => {
    setCollapsed(next)
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]))
    } catch {
      /* storage unavailable */
    }
  }
  const toggle = (title: string) => {
    const next = new Set(collapsed())
    if (!next.delete(title)) next.add(title)
    setAll(next)
  }

  return (
    <div class="flex flex-col gap-3">
      <div class="flex items-center gap-3 text-xs text-text-muted">
        <h2 class="text-[0.66rem] font-semibold uppercase tracking-wider text-text-muted">
          Where config comes from
        </h2>
        <Show when={origins()}>
          <span>
            {groups().reduce((n, g) => n + g.vars.length, 0)} variables
            <Show when={unset()}> · {unset()} unset</Show>
            <Show when={groups().length > 1}>
              {' · '}
              <button
                type="button"
                class="underline hover:text-text-body"
                onClick={() =>
                  setAll(collapsed().size ? new Set() : new Set(groups().map((g) => g.title)))
                }
              >
                {collapsed().size ? 'Expand all' : 'Collapse all'}
              </button>
            </Show>
          </span>
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

      <Show
        when={origins()}
        fallback={
          <Show when={!error()}>
            <div class="empty">Loading config…</div>
          </Show>
        }
      >
        <Show
          when={groups().length}
          fallback={<div class="empty">The app declares no env schema or settings sections.</div>}
        >
          <For each={groups()}>
            {(group) => (
              <section class="card">
                <button
                  type="button"
                  aria-expanded={!collapsed().has(group.title)}
                  onClick={() => toggle(group.title)}
                  class="flex w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left text-xs font-semibold text-text-strong"
                >
                  <span class="inline-block w-2.5 text-text-muted">
                    {collapsed().has(group.title) ? '▸' : '▾'}
                  </span>
                  {group.title}
                  <span class="font-normal text-text-muted">
                    ({group.vars.length}
                    <Show when={group.vars.some((v) => v.origin === 'unset')}>
                      {' · '}
                      {group.vars.filter((v) => v.origin === 'unset').length} unset
                    </Show>
                    )
                  </span>
                </button>
                <Show when={!collapsed().has(group.title)}>
                  <table class="mt-2 w-full text-[0.78rem]">
                    <tbody>
                      <For each={group.vars}>
                        {(v) => (
                          <tr class="border-b border-border/50 last:border-0">
                            <td class="py-1 pr-3 font-mono text-text-body">{v.name}</td>
                            <td class="py-1 text-right">
                              <span
                                class={`rounded-md border px-1.5 py-0.5 text-[0.68rem] font-semibold ${TONE[v.origin]}`}
                              >
                                {LABEL[v.origin]}
                              </span>
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </Show>
              </section>
            )}
          </For>
        </Show>
      </Show>
    </div>
  )
}
