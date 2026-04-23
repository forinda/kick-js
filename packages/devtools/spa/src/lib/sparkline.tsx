import { createMemo, type Component } from 'solid-js'

export interface SparklineProps {
  /** Series of numeric samples, oldest-first. */
  values: readonly number[]
  /** Aspect-ratio width. Height is fixed by the CSS class. */
  width?: number
  /** Override the line colour (default: --accent CSS var). */
  stroke?: string
}

/**
 * Sub-100-byte SVG sparkline. Renders the path `d` attribute as a
 * memoised computation so high-frequency value updates only change
 * that one attribute — Solid's reactivity does the rest of the job
 * (no virtual-DOM diff, no parent re-render).
 */
export const Sparkline: Component<SparklineProps> = (props) => {
  const width = () => props.width ?? 200
  const height = 40

  const path = createMemo(() => {
    const values = props.values
    if (values.length < 2) return ''
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min || 1
    const step = width() / (values.length - 1)
    const norm = (v: number): number => height - ((v - min) / range) * (height - 4) - 2
    let d = `M0 ${norm(values[0]).toFixed(2)}`
    for (let i = 1; i < values.length; i++) {
      d += ` L${(i * step).toFixed(2)} ${norm(values[i]).toFixed(2)}`
    }
    return d
  })

  return (
    <svg
      class="sparkline"
      viewBox={`0 0 ${width()} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={path()} stroke={props.stroke} />
    </svg>
  )
}
