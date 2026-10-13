import { Deferred, useForm } from '@inertiajs/react'
import { Layout } from '~/Layout'

interface Post {
  id: number
  title: string
}

export default function PostsIndex({ posts, stats }: { posts: Post[]; stats?: { total: number } }) {
  const form = useForm({ title: '' })
  return (
    <Layout>
      <h1>Posts</h1>
      <Deferred data="stats" fallback={<p>Loading stats…</p>}>
        <p>Total: {stats?.total}</p>
      </Deferred>
      <ul>
        {posts.map((post) => (
          <li key={post.id}>{post.title}</li>
        ))}
      </ul>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          form.post('/posts', { onSuccess: () => form.reset() })
        }}
      >
        <input
          aria-label="Title"
          value={form.data.title}
          onChange={(event) => form.setData('title', event.target.value)}
        />
        <button disabled={form.processing}>Add</button>
        {form.errors.title && <p style={{ color: 'crimson' }}>{form.errors.title}</p>}
      </form>
    </Layout>
  )
}
