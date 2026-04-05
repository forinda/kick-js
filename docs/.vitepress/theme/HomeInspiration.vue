<script setup lang="ts">
const inspirations = [
  {
    name: 'React Router',
    what: 'Let Vite own the dev server',
    detail: 'The build tool handles ports, HMR, and module loading. Your framework just plugs in.',
    color: '#3b82f6',
  },
  {
    name: 'TanStack Start',
    what: 'Virtual modules for auto-discovery',
    detail: 'Instead of manually registering every file, the framework discovers and imports them for you.',
    color: '#f59e0b',
  },
  {
    name: 'Vinxi',
    what: 'Persist state across hot reloads',
    detail: 'Database connections and long-lived resources survive code changes seamlessly.',
    color: '#10b981',
  },
  {
    name: 'Vue.js',
    what: 'Reactivity isn\'t just for the frontend',
    detail: 'Composable state management with ref, computed, and watch — anywhere in your stack.',
    color: '#42b883',
  },
  {
    name: 'Spring Boot',
    what: 'Elegant inversion of control',
    detail: 'Decorator-driven DI with clear, declarative patterns that scale to large codebases.',
    color: '#6db33f',
  },
  {
    name: 'Laravel',
    what: 'Ship everything out of the box',
    detail: 'Auth, mail, queues, caching, scheduling — plus a CLI that scaffolds entire features.',
    color: '#ff2d20',
  },
  {
    name: 'NestJS',
    what: 'Decorators + DI in TypeScript',
    detail: 'Module system and guard patterns that work beautifully with TypeScript type safety.',
    color: '#e0234e',
  },
  {
    name: 'Express.js',
    what: 'The foundation, not replaced',
    detail: 'Built on Express 5. We add structure on top without hiding the tool underneath.',
    color: '#888888',
  },
]
</script>

<template>
  <section class="inspiration-section">
    <div class="inspiration-header">
      <h2>Built on Proven Patterns</h2>
      <p>
        We studied 6 frameworks in the Vite ecosystem and borrowed the best ideas from each.
      </p>
    </div>
    <div class="inspiration-list">
      <div
        v-for="(item, i) in inspirations"
        :key="item.name"
        class="inspiration-row"
      >
        <div class="row-index">{{ String(Number(i) + 1).padStart(2, '0') }}</div>
        <div class="row-accent" :style="{ background: item.color }" />
        <div class="row-source">{{ item.name }}</div>
        <div class="row-what">{{ item.what }}</div>
        <div class="row-detail">{{ item.detail }}</div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.inspiration-section {
  max-width: 1280px;
  margin: 0 auto;
  padding: 64px 24px 80px;
}

.inspiration-header {
  margin-bottom: 40px;
}

.inspiration-header h2 {
  font-size: 1.8rem;
  font-weight: 700;
  margin: 0 0 8px;
}

.inspiration-header p {
  font-size: 1rem;
  color: var(--vp-c-text-2);
  margin: 0;
  line-height: 1.6;
}

.inspiration-list {
  display: flex;
  flex-direction: column;
}

.inspiration-row {
  display: grid;
  grid-template-columns: 32px 4px 140px 1fr 1fr;
  align-items: center;
  gap: 16px;
  padding: 16px 0;
  border-bottom: 1px solid var(--vp-c-divider);
  transition: background 0.15s ease;
}

.inspiration-row:first-child {
  border-top: 1px solid var(--vp-c-divider);
}

.inspiration-row:hover {
  background: var(--vp-c-bg-soft);
  margin: 0 -12px;
  padding: 16px 12px;
  border-radius: 6px;
}

.row-index {
  font-family: var(--vp-font-family-mono);
  font-size: 0.75rem;
  color: var(--vp-c-text-3);
  font-weight: 500;
}

.row-accent {
  width: 4px;
  height: 24px;
  border-radius: 2px;
}

.row-source {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
  white-space: nowrap;
}

.row-what {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--vp-c-text-1);
}

.row-detail {
  font-size: 0.825rem;
  color: var(--vp-c-text-2);
  line-height: 1.5;
}

/* ── Responsive ─── */

@media (max-width: 960px) {
  .inspiration-row {
    grid-template-columns: 32px 4px 1fr;
    grid-template-rows: auto auto;
    gap: 4px 12px;
  }

  .row-index {
    grid-row: 1 / 3;
  }

  .row-accent {
    grid-row: 1 / 3;
  }

  .row-source {
    grid-column: 3;
    grid-row: 1;
  }

  .row-what {
    grid-column: 3;
    grid-row: 2;
    font-size: 0.825rem;
  }

  .row-detail {
    display: none;
  }
}

@media (max-width: 640px) {
  .inspiration-header h2 {
    font-size: 1.4rem;
  }
}
</style>
