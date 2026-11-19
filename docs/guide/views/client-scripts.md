# Components with a Script

<!-- {{ }} below is template syntax, not VitePress interpolation -->

:::: v-pre

A component can carry its own browser code. Pages that render it get one small script for it; pages that don't get none, so a page stays free of JavaScript until it uses such a component.

```kick
{{-- src/views/components/flash-toast.kick --}}
@input message
@input timeout = 0
<kick-toast timeout="{{ timeout }}" role="status">
  <p>{{ message }}</p>
  <button data-close aria-label="Dismiss">×</button>
</kick-toast>

<script client>
  class KickToast extends HTMLElement {
    connectedCallback(): void {
      const ms = Number(this.getAttribute('timeout'))
      if (ms > 0) setTimeout(() => this.remove(), ms)
      this.querySelector('[data-close]')?.addEventListener('click', () => this.remove())
    }
  }
  customElements.get('kick-toast') || customElements.define('kick-toast', KickToast)
</script>
```

```kick
@if ($flash.success) {
  <flash-toast [message]="$flash.success" [timeout]="5000" />
}
```

- **What it is.** `<script client>` holds TypeScript for the browser, usually a custom element that the component's markup uses. The component's file name and the custom element's tag differ (`flash-toast` renders `<kick-toast>`): a tag that names a component file is that component.
- **What ships.** When a page renders the component, the page gets `<script type="module" src="/_kick/c/flash-toast.<hash>.js">` before `</body>`, once however many times the component renders, and with a `nonce` when the page data has `cspNonce`. The hash changes with the code, and the file caches for a year. A component inside a false `@if` ships nothing.
- **Passing data.** Give the element attributes (escaped like any other); for structured data, a `<script type="application/json">` child. The script is the same for every render, so it can't use `{{ }}`.
- **Imports.** A script can import your own modules (`./format`, `@/lib/dates`, with your Vite aliases) and npm packages:

  ```ts
  import { relativeTime } from './format'
  import { computePosition } from '@floating-ui/dom'
  ```

  `kick build` bundles every component's script in one browser build: each component gets an entry, and code several components import goes into shared chunks, loaded once and sharing its state. Under `kick dev`, the scripts go through Vite's dev pipeline, so imports resolve the same way and edits show on the next load. On plain Node without Vite there's no bundler: scripts that import fail with a clear message, and self-contained scripts still work.

  The browser build takes your app's `define`, mode, `.env` files and aliases, not its Vite plugins. A script can import CSS too (`import './toast.css'`): after `kick build`, a page that renders the component links the stylesheet in its `<head>` (with the page's `nonce`), and under `kick dev` Vite injects it. Images and fonts a script or its CSS imports are inlined as data URIs up to 4 KB; larger ones are files of their own.

- **Types.** `kick build` strips the TypeScript and ships plain JS, which is what edge runtimes serve. Under `kick dev`, Vite strips it. On plain Node, the server strips self-contained scripts with Node's built-in stripper, which needs Node 22.13 or later. The editor treats the block as TypeScript; it doesn't type-check it yet.
- **Rules.** Only in components, at the top level, one per component. Other `<script>` tags render inline as before.
- **Where the files go.** `kick build` writes every client file (entries, shared chunks, CSS, larger images and fonts) to `dist/public/_kick/c/`, with the content hash in each name. On Node, `KickView` serves them from there, cached for a year. On an edge runtime, the platform serves that folder before your worker: `kick g deploy` sets it up for Netlify and Vercel, and on Cloudflare point `assets.directory` in `wrangler.toml` at `dist/public`. For a host with no static files, `kickjs({ views: { clientFiles: 'bundle' } })` keeps everything in the server bundle and inlines every image and font.
- **Serving.** `KickView` serves the scripts on Express, Fastify and h3. On the web fetch entry, call `clientScriptResponse` ahead of the app: `fetch: async (req) => (await clientScriptResponse(views, req)) ?? web.fetch(req)`. The path is `clientScriptPath` (default `/_kick/c`); set it in `vite.config.ts` (`kickjs({ views: { clientScriptPath } })`), and `...kickViews` passes it to `createViews`.
- **Swapped HTML.** A custom element starts whenever it lands in the page, so components inside HTML swapped in by htmx or Turbo work without extra code.

## Toast messages

A toast for flash messages, built as a component with a script. Copy it into your app and style it as you like; KickJS doesn't ship UI components.

```kick
{{-- src/views/components/flash-toast.kick --}}
@input message
@input kind = 'info'
@input position = 'top-right'
@input timeout = 5000
<kick-toast popover="manual" role="status" kind="{{ kind }}" position="{{ position }}" timeout="{{ timeout }}">
  <p>{{ message }}</p>
  <button type="button" data-close aria-label="Dismiss">×</button>
</kick-toast>

<script client>
  class KickToast extends HTMLElement {
    private timer = 0

    connectedCallback(): void {
      // The popover top layer: above everything, no z-index needed.
      this.showPopover?.()
      this.querySelector('[data-close]')?.addEventListener('click', () => this.remove())
      const ms = Number(this.getAttribute('timeout'))
      if (ms > 0) {
        // Readers get time: hovering or focusing it holds the toast, and it
        // only resumes once neither is true (leaving with the pointer while
        // the button still has focus keeps it).
        let hovered = false
        let focused = false
        // One timer at a time: hover and focus can resume it twice in a row.
        const settle = () => {
          window.clearTimeout(this.timer)
          if (!hovered && !focused) this.timer = window.setTimeout(() => this.remove(), ms)
        }
        this.addEventListener('mouseenter', () => ((hovered = true), settle()))
        this.addEventListener('mouseleave', () => ((hovered = false), settle()))
        this.addEventListener('focusin', () => ((focused = true), settle()))
        this.addEventListener('focusout', () => ((focused = false), settle()))
        settle()
      }
    }
  }
  customElements.get('kick-toast') || customElements.define('kick-toast', KickToast)
</script>
```

In the layout, one toast per flash kind (`info`, `success`, `warn`, `error`):

```kick
@for ([kind, message] of $flash | entries; track kind) {
  <flash-toast [kind]="kind" [message]="message" />
}
```

```css
kick-toast {
  position: fixed;
  margin: 0;
  inset: auto;
}
kick-toast[position='top-right'] {
  top: 1rem;
  right: 1rem;
}
kick-toast[position='bottom-left'] {
  bottom: 1rem;
  left: 1rem;
}
kick-toast[kind='success'] {
  border-left: 4px solid green;
}
kick-toast[kind='error'] {
  border-left: 4px solid crimson;
}
```

- **Position and kind** are attributes, so CSS places and colours each toast; add the corners you use.
- **The timeout** is in milliseconds; `[timeout]="0"` keeps a toast until it's dismissed. Hover and focus pause it.
- **Several toasts** stack in the order they render; give later ones an offset in CSS if they share a corner.
- **Screen readers** announce what changes in a `role="status"` region; a toast already in the page when it loads usually isn't read out. For flash messages after a redirect, fill the `<p>` from the script after `showPopover()` (keep the text in an attribute) if announcements matter.
- **Without JavaScript** a `popover` element stays hidden. Leave `popover` off and position the toast with CSS alone if the message must show without scripts.

::::
