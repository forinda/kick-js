<script lang="ts">
  import { Deferred, useForm } from '@inertiajs/svelte'
  import Layout from '../../Layout.svelte'

  interface Post {
    id: number
    title: string
  }

  let { posts, stats }: { posts: Post[]; stats?: { total: number } } = $props()
  const form = useForm({ title: '' })

  function submit(event: SubmitEvent) {
    event.preventDefault()
    form.post('/posts', { onSuccess: () => form.reset() })
  }
</script>

<Layout>
  <h1>Posts</h1>
  <Deferred data="stats">
    {#snippet fallback()}<p>Loading stats…</p>{/snippet}
    <p>Total: {stats?.total}</p>
  </Deferred>
  <ul>
    {#each posts as post (post.id)}<li>{post.title}</li>{/each}
  </ul>
  <form onsubmit={submit}>
    <input bind:value={form.title} aria-label="Title" />
    <button disabled={form.processing}>Add</button>
    {#if form.errors.title}<p style="color: crimson">{form.errors.title}</p>{/if}
  </form>
</Layout>
