<script setup lang="ts">
import { Link } from '@inertiajs/vue3'
import Layout from '../Layout.vue'

// Rendered for unknown URLs (404) and errors thrown while handling a page.
// In production a 5xx message is replaced with a generic one.
defineProps<{ status: number; message: string }>()
</script>

<template>
  <Layout>
    <h1>{{ status }}</h1>
    <p>{{ message }}</p>
    <Link href="/">Back home</Link>
  </Layout>
</template>
