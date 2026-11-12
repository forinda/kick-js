import './app.css'
import { createInertiaApp } from '@inertiajs/react'
import { createRoot, hydrateRoot } from 'react-dom/client'

// Lazy: each page is its own chunk, fetched when it's first visited, so the
// first load doesn't download every page. ssr.tsx keeps `eager: true`; the
// server pays no download for it.
const pages = import.meta.glob('./pages/**/*.tsx')

createInertiaApp({
  resolve: (name) => {
    const page = pages[`./pages/${name}.tsx`]
    if (!page) throw new Error(`No page component at src/client/pages/${name}.tsx`)
    return page() as never
  },
  setup({ el, App, props }) {
    // Server-rendered pages are hydrated; the rest render from scratch.
    if (el.hasAttribute('data-server-rendered')) hydrateRoot(el, <App {...props} />)
    else createRoot(el).render(<App {...props} />)
  },
})
