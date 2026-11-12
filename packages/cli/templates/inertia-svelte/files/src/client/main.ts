import './app.css'
import { createInertiaApp, type ResolvedComponent } from '@inertiajs/svelte'

// Lazy: each page is its own chunk, fetched when it's first visited, so the
// first load doesn't download every page. ssr.ts keeps `eager: true`; the
// server pays no download for it.
const pages = import.meta.glob<ResolvedComponent>('./pages/**/*.svelte')

// Server-rendered pages are hydrated; the rest render from scratch.
createInertiaApp({
  resolve: (name) => {
    const page = pages[`./pages/${name}.svelte`]
    if (!page) throw new Error(`No page component at src/client/pages/${name}.svelte`)
    return page()
  },
})
