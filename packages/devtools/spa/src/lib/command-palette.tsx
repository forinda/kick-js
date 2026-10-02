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

  const results = createMemo(() => filterItems(props.items(), query()).slice(0, 50))

  const show = (): void => {
    setQuery('')
    setIndex(0)
    setOpen(true)
    queueMicrotask(() => input?.focus())
  }
  const close = (): void => {
    setOpen(false)
  }
  const run = (item: PaletteItem | undefined): void => {
    if (!item) return
    close()
    item.run()
  }

  onMount(() => {
    const onKey = (e: KeyboardEvent): void => {
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
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  return (
    <Show when={open()}>
      <div class="dt-palette-backdrop" onClick={(e) => e.target === e.currentTarget && close()}>
        <div class="dt-palette" role="dialog" aria-modal="true" aria-label="Command palette">
          <div class="dt-palette-input">
            <Icon name="search" size={16} />
            <input
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
            <kbd>Esc</kbd>
          </div>
          <div class="dt-palette-list" role="listbox">
            <Show
              when={results().length > 0}
              fallback={<div class="dt-palette-empty">No results for “{query()}”</div>}
            >
              <For each={results()}>
                {(item, i) => (
                  <>
                    <Show when={i() === 0 || results()[i() - 1]!.group !== item.group}>
                      <div class="dt-palette-group">{item.group}</div>
                    </Show>
                    <button
                      type="button"
                      role="option"
                      aria-selected={i() === index()}
                      class={`dt-palette-item ${i() === index() ? 'active' : ''}`}
                      onMouseMove={() => setIndex(i())}
                      onClick={() => run(item)}
                    >
                      <Icon name={item.icon} size={16} />
                      <span class="dt-palette-title">{item.title}</span>
                      <Show when={item.description}>
                        <span class="dt-palette-desc">{item.description}</span>
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
