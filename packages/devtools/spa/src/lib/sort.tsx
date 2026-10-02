/**
 * Sortable table headers: click to sort by a column, again to flip. The
 * arrow keeps its space on every column so headers don't shift.
 */
import { createSignal, type Component, type JSX } from 'solid-js'

export function createSort<K extends string>(initial: K, initialDesc = true) {
  const [key, setKey] = createSignal<K>(initial)
  const [desc, setDesc] = createSignal(initialDesc)
  const toggle = (k: K): void => {
    if (k === key()) setDesc((d) => !d)
    else {
      setKey(() => k)
      setDesc(true)
    }
  }
  /** Sort `rows` by the active column's value. */
  const apply = <T,>(rows: readonly T[], value: (row: T, key: K) => number | string): T[] =>
    rows.toSorted((a, b) => {
      const x = value(a, key())
      const y = value(b, key())
      const cmp =
        typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
      return desc() ? -cmp : cmp
    })
  return { key, desc, toggle, apply, set: setKey }
}

export const SortHeader: Component<{
  label: JSX.Element
  active: boolean
  desc: boolean
  onClick: () => void
  align?: 'left' | 'right'
}> = (props) => (
  <th class={`px-2 py-1.5 font-semibold ${props.align === 'left' ? 'text-left' : 'text-right'}`}>
    <button
      type="button"
      class="inline-flex items-center gap-1 text-text-muted hover:text-text-strong"
      onClick={props.onClick}
    >
      {props.label}
      <span class={props.active ? 'opacity-70' : 'opacity-0'} aria-hidden="true">
        {props.desc ? '↓' : '↑'}
      </span>
    </button>
  </th>
)
