import './app.css'
import { createInertiaApp } from '@inertiajs/vue3'
import type { DefineComponent } from 'vue'

// Lazy: each page is its own chunk, fetched when it's first visited, so the
// first load doesn't download every page. ssr.ts keeps `eager: true`; the
// server pays no download for it.
const pages = import.meta.glob<DefineComponent>('./pages/**/*.vue')

// Server-rendered pages are hydrated; the rest render from scratch.
createInertiaApp({
  resolve: (name) => {
    const page = pages[`./pages/${name}.vue`]
    if (!page) throw new Error(`No page component at src/client/pages/${name}.vue`)
    return page()
  },
})
