<script setup lang="ts">
import { Link, usePage } from '@inertiajs/vue3'
import { computed } from 'vue'
import { Seo } from './Seo'

const page = usePage<{ appName: string }>()
const flash = computed(() => page.flash as { success?: string })
</script>

<template>
  <main style="font-family: system-ui; max-width: 640px; margin: 2rem auto; padding: 0 1rem">
    <Seo />
    <nav style="display: flex; gap: 12px">
      <strong>{{ page.props.appName }}</strong>
      <Link href="/">Home</Link>
      <Link href="/posts">Posts</Link>
    </nav>
    <p v-if="flash.success" style="color: green">{{ flash.success }}</p>
    <slot />
  </main>
</template>
