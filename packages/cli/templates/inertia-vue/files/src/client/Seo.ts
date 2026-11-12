import { Head } from '@inertiajs/vue3'
import { defineComponent, getCurrentInstance, h, watchEffect } from 'vue'
import type { PageMeta } from '@forinda/kickjs-inertia'

// Renders the meta a controller passes to inertia(..., { meta }), merged with
// the InertiaAdapter `meta` defaults — on the server (SSR) and again on every
// client-side visit, so the browser's title and tags follow the page. The
// head-keys match the tags the adapter writes, so each tag is replaced, not
// duplicated. A render function, not a .vue template: templates can't hold
// the JSON-LD <script>.
export const Seo = defineComponent(() => {
  // `$page`, not usePage(): usePage() leaves out the page's `meta`. Read
  // inside the render and the effect, so both follow each visit.
  const app = getCurrentInstance()!.appContext.config.globalProperties
  const pageMeta = () => (app.$page as { meta?: PageMeta }).meta
  // <html lang> sits outside the app; the first visit's HTML has it already.
  if (typeof document !== 'undefined') {
    watchEffect(() => {
      const lang = pageMeta()?.lang
      if (lang) document.documentElement.lang = lang
    })
  }
  return () => {
    const meta = pageMeta()
    if (!meta) return null
    const tags = [
      meta.description &&
        h('meta', { 'head-key': 'description', name: 'description', content: meta.description }),
      meta.robots && h('meta', { 'head-key': 'robots', name: 'robots', content: meta.robots }),
      meta.canonical &&
        h('link', { 'head-key': 'canonical', rel: 'canonical', href: meta.canonical }),
      ...Object.entries(meta.og ?? {}).map(([key, value]) =>
        h('meta', { 'head-key': `og:${key}`, property: `og:${key}`, content: value }),
      ),
      ...Object.entries(meta.twitter ?? {}).map(([key, value]) =>
        h('meta', { 'head-key': `twitter:${key}`, name: `twitter:${key}`, content: value }),
      ),
      // `<` escaped, so a value can't close the script tag.
      meta.jsonLd &&
        h(
          'script',
          { 'head-key': 'json-ld', type: 'application/ld+json' },
          JSON.stringify(meta.jsonLd).replace(/</g, '\\u003c'),
        ),
      ...(meta.head ?? []).map(({ tag, attrs, key }) => h(tag, { 'head-key': key, ...attrs })),
    ].filter(Boolean)
    return h(Head, { title: meta.title }, () => tags)
  }
})
