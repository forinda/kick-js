<script lang="ts">
  import { page } from '@inertiajs/svelte'
  import type { PageMeta } from '@forinda/kickjs-inertia'

  // Renders the meta a controller passes to inertia(..., { meta }), merged
  // with the InertiaAdapter `meta` defaults — on the server (SSR) and again on
  // every client-side visit, so the browser's title and tags follow the page.
  const meta = $derived((page as { meta?: PageMeta }).meta)

  // `<` escaped, so a value can't close the script tag.
  const jsonLd = $derived(
    meta?.jsonLd &&
      `<script type="application/ld+json">${JSON.stringify(meta.jsonLd).replace(/</g, '\\u003c')}</` +
        'script>',
  )

  $effect(() => {
    // <html lang> sits outside the app; the first visit's HTML has it already.
    if (meta?.lang) document.documentElement.lang = meta.lang
    // Tags the server wrote for a page it didn't render: this component's
    // own replace them.
    for (const tag of document.head.querySelectorAll('[data-inertia]')) tag.remove()
  })
</script>

<svelte:head>
  {#if meta}
    {#if meta.title}<title>{meta.title}</title>{/if}
    {#if meta.description}<meta name="description" content={meta.description} />{/if}
    {#if meta.robots}<meta name="robots" content={meta.robots} />{/if}
    {#if meta.canonical}<link rel="canonical" href={meta.canonical} />{/if}
    {#each Object.entries(meta.og ?? {}) as [key, value] (key)}
      <meta property="og:{key}" content={value} />
    {/each}
    {#each Object.entries(meta.twitter ?? {}) as [key, value] (key)}
      <meta name="twitter:{key}" content={value} />
    {/each}
    {#if jsonLd}{@html jsonLd}{/if}
    {#each meta.head ?? [] as { tag, attrs, key } (key)}
      <svelte:element this={tag} {...attrs} />
    {/each}
  {/if}
</svelte:head>
