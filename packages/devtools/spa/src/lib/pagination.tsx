/**
 * Reusable pagination primitive for the DevTools tabs.
 *
 * The legacy Vue dashboard had two ad-hoc paginators (routes table:
 * 15/page, container table: 20/page) with copy-pasted state and
 * UI. This module replaces both with one Solid hook + one component
 * so every long-list tab (Routes, Container, Queues, Graph) uses the
 * same shape and the same keyboard / click affordances.
 *
 * Usage:
 *   const pager = usePagination(() => filteredRows(), { pageSize: 20 })
 *   <For each={pager.page()}>{(row) => <Row row={row} />}</For>
 *   <Pagination pager={pager} />
 */

import { createMemo, createSignal, For, Show, type Accessor, type Component } from 'solid-js'

export interface PaginationOptions {
  /** Initial rows-per-page. Default: 20. */
  pageSize?: number
  /** Allowed pageSize choices for the size selector. Default: [10, 20, 50, 100]. */
  pageSizeChoices?: readonly number[]
}

export interface Pager<T> {
  /** All filtered rows (unpaginated) — useful for "showing X of Y" text. */
  source: Accessor<readonly T[]>
  /** Just this page's slice. */
  page: Accessor<readonly T[]>
  /** Current 1-based page number. */
  current: Accessor<number>
  /** Number of pages (>= 1). */
  total: Accessor<number>
  /** Active page size. */
  pageSize: Accessor<number>
  /** Available page-size choices for the selector. */
  pageSizeChoices: readonly number[]
  /** Range info for the "Showing X – Y of Z" line. */
  range: Accessor<{ start: number; end: number; total: number }>
  /** Imperative controls. */
  goto(p: number): void
  next(): void
  prev(): void
  setPageSize(n: number): void
}

const DEFAULT_PAGE_SIZE_CHOICES = [10, 20, 50, 100] as const

/**
 * Bind reactive pagination state to a row source. The source is a
 * thunk so callers can pipe it through their own filter/sort memo
 * before pagination — the hook stays out of business logic.
 *
 * Auto-clamps the current page when the source shrinks (e.g. a search
 * narrows a 100-row table down to 7 — current page snaps back to 1
 * if the user was viewing page 5).
 */
export function usePagination<T>(
  source: Accessor<readonly T[]>,
  opts: PaginationOptions = {},
): Pager<T> {
  const choices = opts.pageSizeChoices ?? DEFAULT_PAGE_SIZE_CHOICES
  const initial = opts.pageSize ?? choices[1] ?? 20
  const [pageSize, setPageSize] = createSignal(initial)
  const [current, setCurrent] = createSignal(1)

  const total = createMemo(() => Math.max(1, Math.ceil(source().length / pageSize())))

  // Clamp current page whenever total shrinks below it (search input
  // narrows the dataset). Avoids "page 7 of 2" dead-states.
  const safeCurrent = createMemo(() => Math.min(current(), total()))

  const page = createMemo(() => {
    const start = (safeCurrent() - 1) * pageSize()
    return source().slice(start, start + pageSize())
  })

  const range = createMemo(() => {
    const t = source().length
    if (t === 0) return { start: 0, end: 0, total: 0 }
    const start = (safeCurrent() - 1) * pageSize() + 1
    const end = Math.min(safeCurrent() * pageSize(), t)
    return { start, end, total: t }
  })

  return {
    source,
    page,
    current: safeCurrent,
    total,
    pageSize,
    pageSizeChoices: choices,
    range,
    goto(p) {
      setCurrent(Math.max(1, Math.min(p, total())))
    },
    next() {
      setCurrent((c) => Math.min(c + 1, total()))
    },
    prev() {
      setCurrent((c) => Math.max(c - 1, 1))
    },
    setPageSize(n) {
      setPageSize(n)
      // Keep the user roughly anchored to their position when
      // pageSize changes (e.g. 20 -> 50 from page 5 lands on
      // approximately the same row range, not page 5 of the new
      // smaller total).
      const offset = (safeCurrent() - 1) * pageSize()
      setCurrent(Math.max(1, Math.floor(offset / n) + 1))
    },
  }
}

/**
 * Pagination control bar. Renders "Showing X-Y of Z" + Prev / page
 * numbers / Next + page-size selector. Hides itself entirely when
 * the source has <= one page worth of rows so the UI stays calm on
 * small datasets.
 */
export const Pagination: Component<{ pager: Pager<unknown> }> = (props) => {
  const numbers = createMemo(() => {
    // Render up to 7 page buttons centred on the current page so the
    // bar doesn't sprawl on 50-page datasets. Pattern: 1 … 4 5 6 … 50.
    const t = props.pager.total()
    const c = props.pager.current()
    if (t <= 7) return Array.from({ length: t }, (_, i) => i + 1)
    const out: Array<number | 'gap'> = [1]
    const lo = Math.max(2, c - 1)
    const hi = Math.min(t - 1, c + 1)
    if (lo > 2) out.push('gap')
    for (let i = lo; i <= hi; i++) out.push(i)
    if (hi < t - 1) out.push('gap')
    out.push(t)
    return out
  })

  return (
    <Show when={props.pager.total() > 1 || props.pager.source().length > props.pager.pageSize()}>
      <div class="flex items-center justify-between mt-4 pt-3 border-t border-slate-800 text-xs text-slate-500">
        <div class="flex items-center gap-3">
          <span>
            Showing {props.pager.range().start}–{props.pager.range().end} of{' '}
            {props.pager.range().total}
          </span>
          <label class="flex items-center gap-1">
            <span class="text-slate-600">Per page</span>
            <select
              class="bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-slate-200"
              value={props.pager.pageSize()}
              onChange={(e) => props.pager.setPageSize(Number(e.currentTarget.value))}
            >
              <For each={props.pager.pageSizeChoices}>
                {(n) => <option value={n}>{n}</option>}
              </For>
            </select>
          </label>
        </div>
        <div class="flex items-center gap-1">
          <button
            type="button"
            class="px-2.5 py-1 rounded border border-slate-700 bg-slate-800 hover:bg-slate-700 disabled:opacity-30"
            disabled={props.pager.current() === 1}
            onClick={() => props.pager.prev()}
          >
            Prev
          </button>
          <For each={numbers()}>
            {(n) => (
              <Show
                when={n === 'gap'}
                fallback={
                  <button
                    type="button"
                    class={`px-2.5 py-1 rounded border ${
                      n === props.pager.current()
                        ? 'border-kick-500/30 bg-kick-500/20 text-kick-500'
                        : 'border-slate-700 bg-slate-800 hover:bg-slate-700'
                    }`}
                    onClick={() => props.pager.goto(n as number)}
                  >
                    {n}
                  </button>
                }
              >
                <span class="px-1 text-slate-600">…</span>
              </Show>
            )}
          </For>
          <button
            type="button"
            class="px-2.5 py-1 rounded border border-slate-700 bg-slate-800 hover:bg-slate-700 disabled:opacity-30"
            disabled={props.pager.current() === props.pager.total()}
            onClick={() => props.pager.next()}
          >
            Next
          </button>
        </div>
      </div>
    </Show>
  )
}
