<script setup lang="ts">
import Layout from '../Layout.vue'

defineProps<{ greeting: string }>()
</script>

<template>
  <Layout>
    <h1>{{ greeting }}</h1>
    <p>
      Pages are Vue components in <code>src/client/pages</code>; their props come from the
      controller in <code>src/modules/pages</code>.
    </p>
  </Layout>
</template>
