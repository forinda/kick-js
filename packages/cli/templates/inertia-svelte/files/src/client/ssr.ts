// Also imported here, so the dev server can link it in server-rendered HTML.
import './app.css'
import { createInertiaApp, type ResolvedComponent } from '@inertiajs/svelte'
import type { Page } from '@inertiajs/core'
import { render } from 'svelte/server'

const pages = import.meta.glob<ResolvedComponent>('./pages/**/*.svelte', { eager: true })

// Called by InertiaAdapter to render a page on the server: the page object
// in, `{ head, body }` out.
export default (page: Page) =>
  createInertiaApp({
    page,
    resolve: (name) => pages[`./pages/${name}.svelte`]!,
    setup: ({ App, props }) => render(App, { props }),
  })
