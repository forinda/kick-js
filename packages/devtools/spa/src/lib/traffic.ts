/**
 * Request counts sampled once a second, for the Overview's sparklines. The
 * stream only says "the count is now N" when it changes, so a quiet second
 * would otherwise leave no point. Runs from boot so the history is there the
 * first time the Overview opens.
 */
import { createSignal } from 'solid-js'
import { store } from './store'

const SAMPLES = 61 // 60 one-second intervals

const [requestCounts, setRequestCounts] = createSignal<number[]>([])
const [serverErrorCounts, setServerErrorCounts] = createSignal<number[]>([])

export { requestCounts, serverErrorCounts }

export function startTrafficSampler(): () => void {
  const timer = setInterval(() => {
    const m = store.metrics()
    if (!m) return
    setRequestCounts((prev) => [...prev, m.requests].slice(-SAMPLES))
    setServerErrorCounts((prev) => [...prev, m.serverErrors].slice(-SAMPLES))
  }, 1000)
  return () => clearInterval(timer)
}
