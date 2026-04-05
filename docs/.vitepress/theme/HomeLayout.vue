<script setup lang="ts">
import { useData } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import HomeHero from './HomeHero.vue'
import HomeInspiration from './HomeInspiration.vue'

const { frontmatter } = useData()
</script>

<template>
  <DefaultTheme.Layout>
    <template #home-hero-before>
      <HomeHero />
    </template>
    <template #home-features-after>
      <HomeInspiration />
    </template>
  </DefaultTheme.Layout>
</template>
