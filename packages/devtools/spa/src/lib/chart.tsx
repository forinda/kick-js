/**
 * A small time-series chart: one or more lines over the same samples, the
 * latest value and the range in the corners, and optional tick marks
 * (sample indices) along the bottom — e.g. where a GC ran.
 */
import { createMemo, For, Show, type Component, type JSX } from 'solid-js'

export interface ChartSeries {
  label: string
  values: readonly number[]
  /** CSS colour; the first series defaults to the accent, the rest to a muted tone. */
  color?: string
}

const W = 300
const H = 80

export const Chart: Component<{
  title: string
  series: ChartSeries[]
  format: (v: number) => string
  /** Fixed y-axis top (e.g. 100 for a percentage); default: the data's max. */
  max?: number
  /** Sample indices to tick along the bottom. */
  marks?: readonly number[]
  /** Extra header content, right of the title. */
  info?: JSX.Element
}> = (props) => {
  const length = createMemo(() => Math.max(0, ...props.series.map((s) => s.values.length)))
  const top = createMemo(
    () => props.max ?? (Math.max(0, ...props.series.flatMap((s) => [...s.values])) * 1.1 || 1),
  )
  const x = (i: number): number => (length() > 1 ? (i / (length() - 1)) * W : 0)
  const y = (v: number): number => H - (Math.min(v, top()) / top()) * (H - 2) - 1
  const path = (values: readonly number[]): string =>
    values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  const colour = (s: ChartSeries, i: number): string =>
    s.color ?? (i === 0 ? 'var(--color-accent)' : 'var(--color-text-muted)')
  const latest = (s: ChartSeries): number | undefined => s.values[s.values.length - 1]

  return (
    <section class="flex flex-col rounded-xl border border-border bg-surface-1 px-4 pt-3 pb-2">
      <header class="flex items-baseline gap-2">
        <h3 class="text-[0.66rem] font-semibold uppercase tracking-wider text-text-muted">
          {props.title}
        </h3>
        {props.info}
        <span class="flex-1" />
        <For each={props.series}>
          {(s, i) => (
            <Show when={latest(s) !== undefined}>
              <span class="flex items-center gap-1 text-xs text-text-muted">
                <Show when={props.series.length > 1}>
                  <span
                    class="inline-block h-0.5 w-2.5 rounded"
                    style={{ background: colour(s, i()) }}
                  />
                  {s.label}
                </Show>
                <span
                  class={`tabular-nums ${i() === 0 ? 'text-base font-semibold text-text-strong' : ''}`}
                >
                  {props.format(latest(s)!)}
                </span>
              </span>
            </Show>
          )}
        </For>
      </header>
      <div class="relative mt-1">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" class="block h-20 w-full">
          <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} stroke="var(--color-border)" />
          <For each={props.marks ?? []}>
            {(i) => (
              <line
                x1={x(i)}
                x2={x(i)}
                y1={H - 6}
                y2={H}
                stroke="var(--color-text-muted)"
                vector-effect="non-scaling-stroke"
              />
            )}
          </For>
          {/* Drawn last-first so the first series sits on top. */}
          <For each={props.series.map((s, i) => ({ s, i })).toReversed()}>
            {({ s, i }) => (
              <path
                d={path(s.values)}
                fill="none"
                stroke={colour(s, i)}
                stroke-width="1.5"
                stroke-linejoin="round"
                vector-effect="non-scaling-stroke"
              />
            )}
          </For>
        </svg>
        <span class="pointer-events-none absolute top-0 left-0 text-[0.6rem] text-text-muted tabular-nums">
          {props.format(top())}
        </span>
      </div>
      <div class="flex justify-between text-[0.6rem] text-text-muted">
        <span>{length() > 1 ? `${length()}s ago` : ''}</span>
        <span>now</span>
      </div>
    </section>
  )
}
