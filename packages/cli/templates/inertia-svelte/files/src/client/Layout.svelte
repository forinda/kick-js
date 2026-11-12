<script lang="ts">
  import { Link, page } from '@inertiajs/svelte'
  import type { Snippet } from 'svelte'
  import Seo from './Seo.svelte'

  let { children }: { children: Snippet } = $props()
  const flash = $derived(page.flash as { success?: string })
</script>

<main style="font-family: system-ui; max-width: 640px; margin: 2rem auto; padding: 0 1rem">
  <Seo />
  <nav style="display: flex; gap: 12px">
    <strong>{page.props.appName}</strong>
    <Link href="/">Home</Link>
    <Link href="/posts">Posts</Link>
  </nav>
  {#if flash.success}<p style="color: green">{flash.success}</p>{/if}
  {@render children()}
</main>
