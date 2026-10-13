// Also imported here, so the dev server can link it in server-rendered HTML.
import './app.css'
import { createInertiaApp } from '@inertiajs/react'
import type { Page } from '@inertiajs/core'
import { renderToString } from 'react-dom/server'

const pages = import.meta.glob('./pages/**/*.tsx', { eager: true })

// Called by InertiaAdapter to render a page on the server: the page object
// in, `{ head, body }` out.
export default (page: Page) =>
  createInertiaApp({
    page,
    render: renderToString,
    resolve: (name) => pages[`./pages/${name}.tsx`] as never,
    setup: ({ App, props }) => <App {...props} />,
  })
