<script lang="ts">
  import { Link } from '@inertiajs/svelte'
  import Layout from '../Layout.svelte'

  // Rendered for unknown URLs (404) and errors thrown while handling a page.
  // In production a 5xx message is replaced with a generic one.
  let { status, message }: { status: number; message: string } = $props()
</script>

<Layout>
  <h1>{status}</h1>
  <p>{message}</p>
  <Link href="/">Back home</Link>
</Layout>
