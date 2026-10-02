/**
 * Two panes with a draggable divider — a list on the left, its detail on the
 * right. The left width is remembered per `storageKey`.
 */
import { createSignal, onCleanup, type Component, type JSX } from 'solid-js'

const MIN = 240
const MAX = 720

export const SplitPane: Component<{
  storageKey: string
  defaultLeft?: number
  left: JSX.Element
  right: JSX.Element
}> = (props) => {
  const key = `kickjs-devtools-split:${props.storageKey}`
  const initial = (() => {
    try {
      const n = Number(localStorage.getItem(key))
      if (n >= MIN && n <= MAX) return n
    } catch {
      // storage unavailable
    }
    return props.defaultLeft ?? 380
  })()
  const [width, setWidth] = createSignal(initial)
  let stop: (() => void) | null = null
  onCleanup(() => stop?.())

  const start = (e: MouseEvent): void => {
    e.preventDefault()
    const x0 = e.clientX
    const w0 = width()
    document.body.style.cursor = 'col-resize'
    const move = (ev: MouseEvent) => setWidth(Math.min(MAX, Math.max(MIN, w0 + ev.clientX - x0)))
    const up = (): void => {
      stop?.()
      try {
        localStorage.setItem(key, String(width()))
      } catch {
        // storage unavailable
      }
    }
    stop = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      document.body.style.cursor = ''
      stop = null
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  return (
    <div class="dt-split">
      <div class="dt-split-left" style={`width:${width()}px`}>
        {props.left}
      </div>
      <div class="dt-resizer" role="separator" aria-orientation="vertical" onMouseDown={start} />
      <div class="dt-split-right">{props.right}</div>
    </div>
  )
}
