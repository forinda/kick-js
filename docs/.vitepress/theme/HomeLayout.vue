<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import HomeHero from './HomeHero.vue'
</script>

<template>
  <DefaultTheme.Layout>
    <template #home-hero-before>
      <HomeHero />
    </template>
  </DefaultTheme.Layout>
</template>
