/**
 * A flag's value, laid out to read rather than as raw JSON: an object as
 * key/value rows, a list of plain values as chips (long lists fold), nested
 * values indented. Anything deeper than a few levels falls back to JSON.
 */
import { createSignal, For, Show, type Component } from 'solid-js'
import { splitList } from './route-meta'

const FOLD_AT = 8

const isPlain = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v)

const Chips: Component<{ items: unknown[] }> = (props) => {
  const [all, setAll] = createSignal(false)
  const split = () => splitList(props.items, FOLD_AT, all())
  return (
    <span class="flex flex-wrap items-center gap-1">
      <For each={split().shown}>
        {(item) => (
          <span class="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.68rem] text-text-body">
            {String(item)}
          </span>
        )}
      </For>
      <Show when={split().more || (all() && props.items.length > FOLD_AT)}>
        <button
          type="button"
          class="text-[0.68rem] text-kick-500 hover:underline"
          onClick={() => setAll(!all())}
        >
          {all() ? 'show less' : `+${split().more} more`}
        </button>
      </Show>
    </span>
  )
}

export const FlagValue: Component<{ value: unknown; depth?: number }> = (props) => {
  const depth = () => props.depth ?? 0
  const v = () => props.value
  return (
    <Show
      when={!isPlain(v())}
      fallback={<span class="font-mono text-[0.72rem] text-text-body">{JSON.stringify(v())}</span>}
    >
      <Show
        when={depth() < 3}
        fallback={
          <pre class="overflow-x-auto rounded bg-surface-2 px-2 py-1 font-mono text-[0.68rem] text-text-secondary">
            {JSON.stringify(v(), null, 2)}
          </pre>
        }
      >
        <Show
          when={!Array.isArray(v())}
          fallback={
            <Show
              when={(v() as unknown[]).every(isPlain)}
              fallback={
                <ol class="flex flex-col gap-1 pl-3">
                  <For each={v() as unknown[]}>
                    {(item) => (
                      <li>
                        <FlagValue value={item} depth={depth() + 1} />
                      </li>
                    )}
                  </For>
                </ol>
              }
            >
              <Chips items={v() as unknown[]} />
            </Show>
          }
        >
          <dl class="grid grid-cols-[max-content_1fr] items-baseline gap-x-3 gap-y-1">
            <For each={Object.entries(v() as Record<string, unknown>)}>
              {([key, value]) => (
                <>
                  <dt class="font-mono text-[0.68rem] text-text-muted">{key}</dt>
                  <dd class="min-w-0">
                    <FlagValue value={value} depth={depth() + 1} />
                  </dd>
                </>
              )}
            </For>
          </dl>
        </Show>
      </Show>
    </Show>
  )
}
