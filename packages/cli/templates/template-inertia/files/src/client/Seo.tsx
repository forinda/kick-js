import { Head, usePage } from '@inertiajs/react'
import { createElement, useEffect } from 'react'
import type { PageMeta } from '@forinda/kickjs-inertia'

// Renders the meta a controller passes to inertia(..., { meta }), merged with
// the InertiaAdapter `meta` defaults — on the server (SSR) and again on every
// client-side visit, so the browser's title and tags follow the page. The
// head-keys match the tags the adapter writes, so each tag is replaced, not
// duplicated.
export function Seo() {
  const meta = (usePage() as { meta?: PageMeta }).meta
  // <html lang> sits outside the app; the first visit's HTML has it already.
  useEffect(() => {
    if (meta?.lang) document.documentElement.lang = meta.lang
  }, [meta?.lang])
  if (!meta) return null
  return (
    <Head title={meta.title}>
      {meta.description && (
        <meta head-key="description" name="description" content={meta.description} />
      )}
      {meta.robots && <meta head-key="robots" name="robots" content={meta.robots} />}
      {meta.canonical && <link head-key="canonical" rel="canonical" href={meta.canonical} />}
      {Object.entries(meta.og ?? {}).map(([key, value]) => (
        <meta key={key} head-key={`og:${key}`} property={`og:${key}`} content={value} />
      ))}
      {Object.entries(meta.twitter ?? {}).map(([key, value]) => (
        <meta key={key} head-key={`twitter:${key}`} name={`twitter:${key}`} content={value} />
      ))}
      {meta.jsonLd && (
        <script
          head-key="json-ld"
          type="application/ld+json"
          // `<` escaped, so a value can't close the script tag.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(meta.jsonLd).replace(/</g, '\\u003c') }}
        />
      )}
      {meta.head?.map(({ tag, attrs, key }) =>
        createElement(tag, { key, 'head-key': key, ...attrs }),
      )}
    </Head>
  )
}
