// Also imported here, so the dev server can link it in server-rendered HTML.
import './app.css'
import { createInertiaApp } from '@inertiajs/vue3'
import type { Page } from '@inertiajs/core'
import { createSSRApp, h, type DefineComponent } from 'vue'
import { renderToString } from 'vue/server-renderer'

const pages = import.meta.glob<DefineComponent>('./pages/**/*.vue', {
  eager: true,
  import: 'default',
})

// Called by InertiaAdapter to render a page on the server: the page object
// in, `{ head, body }` out.
export default (page: Page) =>
  createInertiaApp({
    page,
    render: renderToString,
    resolve: (name) => pages[`./pages/${name}.vue`]!,
    setup: ({ App, props, plugin }) => createSSRApp({ render: () => h(App, props) }).use(plugin),
  })
