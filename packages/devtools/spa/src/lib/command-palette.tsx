/**
 * Command palette — ⌘K / Ctrl+K, or `/` outside a text field. Jumps to a tab,
 * a route (opens the API runner), a DI token (opens its detail), or runs a
 * dashboard action. Arrow keys move, Enter runs, Escape closes.
 */
import { createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from 'solid-js'
import { filterItems, type PaletteItem } from './palette-core'
import { Icon } from './icons'

export const CommandPalette: Component<{ items: () => PaletteItem[] }> = (props) => {
  const [open, setOpen] = createSignal(false)
  const [query, setQuery] = createSignal('')
  const [index, setIndex] = createSignal(0)
  let input: HTMLInputElement | undefined
  let dialog: HTMLDivElement | undefined
  /** What had focus before the palette opened — it gets it back on close. */
  let restoreFocus: HTMLElement | null = null

  const results = createMemo(() => filterItems(props.items(), query()).slice(0, 50))

  const show = (): void => {
    restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setQuery('')
    setIndex(0)
    setOpen(true)
    queueMicrotask(() => input?.focus())
  }
  const close = (): void => {
    setOpen(false)
    restoreFocus?.focus()
    restoreFocus = null
  }
  const run = (item: PaletteItem | undefined): void => {
    if (!item) return
    close()
    item.run()
  }

  onMount(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Escape closes from anywhere in the palette, not just the input.
      if (e.key === 'Escape' && open()) {
        e.preventDefault()
        close()
        return
      }
      const typing =
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing && !open())) {
        e.preventDefault()
        if (open()) close()
        else show()
      }
    }
    document.addEventListener('keydown', onKey)
    onCleanup(() => document.removeEventListener('keydown', onKey))
  })

  const onInputKey = (e: KeyboardEvent): void => {
    const n = results().length
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => (n ? (i + 1) % n : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => (n ? (i - 1 + n) % n : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(results()[index()])
    }
  }

  /** Keep Tab inside the palette: cycle through the input and the results. */
  const onDialogKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Tab' || !dialog) return
    const stops = [input, ...dialog.querySelectorAll<HTMLElement>('[role="option"]')].filter(
      (el): el is HTMLElement => !!el,
    )
    if (stops.length === 0) return
    const at = stops.indexOf(document.activeElement as HTMLElement)
    const next = e.shiftKey ? (at <= 0 ? stops.length - 1 : at - 1) : (at + 1) % stops.length
    e.preventDefault()
    stops[next]!.focus()
  }

  return (
    <Show when={open()}>
      <div
        class="fixed inset-0 z-70 flex items-start justify-center bg-black/45 pt-[12vh]"
        onClick={(e) => e.target === e.currentTarget && close()}
      >
        <div
          class="flex max-h-[60vh] w-[min(640px,calc(100vw-32px))] flex-col overflow-hidden rounded-md border border-border-strong bg-surface-1 shadow-2xl"
          ref={(el) => (dialog = el)}
          onKeyDown={onDialogKey}
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
        >
          <div class="flex items-center gap-2.5 border-b border-border px-3.5 py-2.5 text-text-muted">
            <Icon name="search" size={16} />
            <input
              class="flex-1 border-none bg-transparent text-sm text-text-body outline-none"
              ref={(el) => (input = el)}
              value={query()}
              placeholder="Jump to a tab, route or DI token…"
              aria-label="Search"
              onInput={(e) => {
                setQuery(e.currentTarget.value)
                setIndex(0)
              }}
              onKeyDown={onInputKey}
            />
            <kbd class="dt-kbd">Esc</kbd>
          </div>
          <div class="overflow-y-auto p-1.5" role="listbox">
            <Show
              when={results().length > 0}
              fallback={
                <div class="p-6 text-center text-text-muted">No results for “{query()}”</div>
              }
            >
              <For each={results()}>
                {(item, i) => (
                  <>
                    <Show when={i() === 0 || results()[i() - 1]!.group !== item.group}>
                      <div class="px-2 pt-2 pb-1 text-[0.64rem] font-bold uppercase tracking-wider text-text-muted">
                        {item.group}
                      </div>
                    </Show>
                    <button
                      type="button"
                      role="option"
                      aria-selected={i() === index()}
                      class={`flex w-full cursor-pointer items-center gap-2.5 rounded-md border-none px-2 py-1.5 text-left text-[0.82rem] ${
                        i() === index()
                          ? 'bg-accent/15 text-text-strong'
                          : 'bg-transparent text-text-secondary'
                      }`}
                      onMouseMove={() => setIndex(i())}
                      onClick={() => run(item)}
                    >
                      <Icon name={item.icon} size={16} />
                      <span class="whitespace-nowrap">{item.title}</span>
                      <Show when={item.description}>
                        <span class="min-w-0 truncate text-xs text-text-muted">
                          {item.description}
                        </span>
                      </Show>
                    </button>
                  </>
                )}
              </For>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  )
}

/** Open from a button — the header's search hint. */
export function openCommandPalette(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
}
