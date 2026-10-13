import './app.css'
import { createInertiaApp } from '@inertiajs/react'
import { createRoot, hydrateRoot } from 'react-dom/client'

const pages = import.meta.glob('./pages/**/*.tsx', { eager: true })

createInertiaApp({
  resolve: (name) => pages[`./pages/${name}.tsx`] as never,
  setup({ el, App, props }) {
    // Server-rendered pages are hydrated; the rest render from scratch.
    if (el.hasAttribute('data-server-rendered')) hydrateRoot(el, <App {...props} />)
    else createRoot(el).render(<App {...props} />)
  },
})
