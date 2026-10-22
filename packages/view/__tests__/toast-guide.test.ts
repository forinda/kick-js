// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

/** The guide's toast component script, as readers copy it. */
function guideToastScript(): string {
  const guide = readFileSync(join(import.meta.dirname, '../../../docs/guide/views.md'), 'utf8')
  const start = guide.indexOf(
    '{{-- src/views/components/flash-toast.kick --}}\n@input message\n@input kind',
  )
  const script = /<script client>([\s\S]*?)<\/script>/.exec(guide.slice(start))![1]!
  // Node's typings list only 'strip'; 'transform' compiles what a build would.
  return stripTypeScriptTypes(script, { mode: 'transform' } as never)
}

beforeAll(() => {
  new Function(guideToastScript())()
})
afterEach(() => vi.useRealTimers())

function toast(timeout: number): HTMLElement {
  document.body.innerHTML = `<kick-toast popover="manual" role="status" timeout="${timeout}"><p>Saved</p><button type="button" data-close>×</button></kick-toast>`
  return document.querySelector('kick-toast') as HTMLElement
}

describe('the toast guide', () => {
  it('keeps one timer however the pauses and resumes interleave', () => {
    vi.useFakeTimers()
    const el = toast(1000)
    for (const type of ['mouseenter', 'focusin', 'mouseleave', 'focusout', 'mouseleave'])
      el.dispatchEvent(new Event(type, { bubbles: type.startsWith('focus') }))
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(1000)
    expect(document.querySelector('kick-toast')).toBeNull()
  })

  it('stays while paused', () => {
    vi.useFakeTimers()
    const el = toast(1000)
    el.dispatchEvent(new Event('mouseenter'))
    vi.advanceTimersByTime(5000)
    expect(document.querySelector('kick-toast')).not.toBeNull()
  })
})
