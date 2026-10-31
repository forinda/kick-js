/** The footer controls of a paged list. */

import { For, Show, type Component } from 'solid-js'
import { PAGE_SIZES } from './paging'

const BUTTON =
  'rounded-md border border-border-strong bg-surface-2 px-2 py-0.5 text-xs text-text-secondary hover:text-text-strong disabled:opacity-50'

export const PageSizeSelect: Component<{
  value: number
  label: string
  onChange(size: number): void
}> = (props) => (
  <select
    class="rounded-md border border-border-strong bg-surface-2 px-1 py-0.5 text-[0.7rem] text-text-secondary"
    aria-label={props.label}
    title={props.label}
    value={props.value}
    onChange={(e) => props.onChange(Number(e.currentTarget.value))}
  >
    <For each={PAGE_SIZES}>{(n) => <option value={n}>{n} / page</option>}</For>
  </select>
)

export const Pager: Component<{
  range: string
  page: number
  /** Undefined when the total isn't known: no "last page" button then. */
  lastPage?: number
  hasNext: boolean
  onPage(page: number): void
}> = (props) => (
  <>
    <span class="tabular-nums">{props.range}</span>
    <span class="flex-1" />
    <button
      type="button"
      class={BUTTON}
      disabled={props.page === 0}
      onClick={() => props.onPage(0)}
      aria-label="First page"
    >
      «
    </button>
    <button
      type="button"
      class={BUTTON}
      disabled={props.page === 0}
      onClick={() => props.onPage(props.page - 1)}
      aria-label="Previous page"
    >
      ‹
    </button>
    <span class="tabular-nums">
      page {props.page + 1}
      {props.lastPage !== undefined ? ` of ${props.lastPage + 1}` : ''}
    </span>
    <button
      type="button"
      class={BUTTON}
      disabled={!props.hasNext}
      onClick={() => props.onPage(props.page + 1)}
      aria-label="Next page"
    >
      ›
    </button>
    <Show when={props.lastPage !== undefined}>
      <button
        type="button"
        class={BUTTON}
        disabled={props.page >= props.lastPage!}
        onClick={() => props.onPage(props.lastPage!)}
        aria-label="Last page"
      >
        »
      </button>
    </Show>
  </>
)
