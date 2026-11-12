<script setup lang="ts">
import { Deferred, useForm } from '@inertiajs/vue3'
import Layout from '../../Layout.vue'

interface Post {
  id: number
  title: string
}

defineProps<{ posts: Post[]; stats?: { total: number } }>()
const form = useForm({ title: '' })
const submit = () => form.post('/posts', { onSuccess: () => form.reset() })
</script>

<template>
  <Layout>
    <h1>Posts</h1>
    <Deferred data="stats">
      <template #fallback><p>Loading stats…</p></template>
      <p>Total: {{ stats?.total }}</p>
    </Deferred>
    <ul>
      <li v-for="post in posts" :key="post.id">{{ post.title }}</li>
    </ul>
    <form @submit.prevent="submit">
      <input v-model="form.title" aria-label="Title" />
      <button :disabled="form.processing">Add</button>
      <p v-if="form.errors.title" style="color: crimson">{{ form.errors.title }}</p>
    </form>
  </Layout>
</template>
