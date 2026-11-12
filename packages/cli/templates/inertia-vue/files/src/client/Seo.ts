import { Head, usePage } from '@inertiajs/vue3'
import { defineComponent, h, watchEffect } from 'vue'
import type { PageMeta } from '@forinda/kickjs-inertia'

// Renders the meta a controller passes to inertia(..., { meta }), merged with
// the InertiaAdapter `meta` defaults — on the server (SSR) and again on every
// client-side visit, so the browser's title and tags follow the page. The
// head-keys match the tags the adapter writes, so each tag is replaced, not
// duplicated. A render function, not a .vue template: templates can't hold
// the JSON-LD <script>.
export const Seo = defineComponent(() => {
  const page = usePage()
  // <html lang> sits outside the app; the first visit's HTML has it already.
  if (typeof document !== 'undefined') {
    watchEffect(() => {
      const lang = (page as { meta?: PageMeta }).meta?.lang
      if (lang) document.documentElement.lang = lang
    })
  }
  return () => {
    const meta = (page as { meta?: PageMeta }).meta
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
