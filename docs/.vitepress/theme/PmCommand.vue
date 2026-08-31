<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { pm, setPm, hydratePm, MANAGERS, type Manager } from './use-package-manager'

const props = defineProps<{
  /** Install one or more dependencies: `add="@forinda/kickjs-swagger"` */
  add?: string
  /** Install as a dev dependency. Pairs with `add`. */
  dev?: boolean
  /** Run a one-off binary without installing it: `dlx="@forinda/kickjs-cli new my-api"` */
  dlx?: string
  /** Run a package script: `run="dev"`. Newline-separate for several lines. */
  run?: string
  /** Run a locally-installed binary that has no script behind it: `exec="kick g module users"` */
  exec?: string
  /** Install everything in the lockfile. */
  install?: boolean
}>()

/**
 * One command, rendered four ways. The differences are small but not
 * derivable from a single template — npm needs `run` where pnpm does not,
 * `npx` is not `npm dlx`, and only npm spells install `install` for a
 * named package.
 *
 * `run` is for a script in package.json (`dev`, `build`, `test`); `exec` is
 * for a local binary with no script behind it (`kick g module users`).
 * Getting these the wrong way round is how a doc ends up telling npm users
 * to `npm run kick dev`, which looks for a script named "kick".
 */
const RECIPES: Record<Manager, (p: typeof props) => string[]> = {
  pnpm: (p) =>
    [
      p.install && 'pnpm install',
      p.add && `pnpm add ${p.dev ? '-D ' : ''}${p.add}`,
      p.dlx && `pnpm dlx ${p.dlx}`,
      ...lines(p.run).map((c) => `pnpm ${c}`),
      ...lines(p.exec).map((c) => `pnpm exec ${c}`),
    ].filter(Boolean) as string[],

  npm: (p) =>
    [
      p.install && 'npm install',
      p.add && `npm install ${p.dev ? '-D ' : ''}${p.add}`,
      p.dlx && `npx ${p.dlx}`,
      ...lines(p.run).map((c) => `npm run ${c}`),
      ...lines(p.exec).map((c) => `npx ${c}`),
    ].filter(Boolean) as string[],

  yarn: (p) =>
    [
      p.install && 'yarn install',
      p.add && `yarn add ${p.dev ? '-D ' : ''}${p.add}`,
      p.dlx && `yarn dlx ${p.dlx}`,
      ...lines(p.run).map((c) => `yarn ${c}`),
      ...lines(p.exec).map((c) => `yarn ${c}`),
    ].filter(Boolean) as string[],

  bun: (p) =>
    [
      p.install && 'bun install',
      p.add && `bun add ${p.dev ? '-d ' : ''}${p.add}`,
      p.dlx && `bunx ${p.dlx}`,
      ...lines(p.run).map((c) => `bun ${c}`),
      ...lines(p.exec).map((c) => `bunx ${c}`),
    ].filter(Boolean) as string[],
}

function lines(value?: string): string[] {
  return (value ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

onMounted(hydratePm)

const commands = computed(() => RECIPES[pm.value](props))
const text = computed(() => commands.value.join('\n'))

const copied = ref(false)
async function copy() {
  try {
    await navigator.clipboard.writeText(text.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1600)
  } catch {
    // Clipboard is unavailable (insecure origin, denied permission) — the
    // command is on screen either way, so there is nothing to recover.
  }
}
</script>

<template>
  <div class="pm-command">
    <div class="pm-command__bar">
      <span class="pm-command__prompt" aria-hidden="true">&gt;_</span>
      <div class="pm-command__tabs" role="tablist" aria-label="Package manager">
        <button
          v-for="m in MANAGERS"
          :key="m"
          role="tab"
          type="button"
          :aria-selected="pm === m"
          :class="['pm-command__tab', { 'is-active': pm === m }]"
          @click="setPm(m)"
        >
          {{ m }}
        </button>
      </div>
      <button
        class="pm-command__copy"
        type="button"
        :aria-label="copied ? 'Copied' : 'Copy command'"
        @click="copy"
      >
        {{ copied ? '✓' : '⧉' }}
      </button>
    </div>
    <pre class="pm-command__code"><code>{{ text }}</code></pre>
  </div>
</template>

<style scoped>
.pm-command {
  margin: 16px 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  overflow: hidden;
  background: var(--vp-code-block-bg);
}

.pm-command__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px 6px 12px;
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
}

.pm-command__prompt {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--vp-c-text-3);
}

.pm-command__tabs {
  display: flex;
  gap: 2px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
}

.pm-command__tab {
  padding: 3px 10px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--vp-c-text-2);
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  line-height: 1.6;
  cursor: pointer;
  white-space: nowrap;
  transition:
    color 0.2s,
    background-color 0.2s;
}

.pm-command__tab:hover {
  color: var(--vp-c-text-1);
}

.pm-command__tab.is-active {
  color: var(--vp-c-text-1);
  background: var(--vp-c-default-soft);
}

.pm-command__copy {
  border: 0;
  background: transparent;
  color: var(--vp-c-text-3);
  cursor: pointer;
  font-size: 15px;
  line-height: 1;
  padding: 4px 6px;
  border-radius: 5px;
}

.pm-command__copy:hover {
  color: var(--vp-c-text-1);
  background: var(--vp-c-default-soft);
}

.pm-command__code {
  margin: 0;
  padding: 12px 16px;
  overflow-x: auto;
  font-family: var(--vp-font-family-mono);
  font-size: var(--vp-code-font-size);
  line-height: var(--vp-code-line-height);
  color: var(--vp-c-text-1);
}

.pm-command__code code {
  background: transparent;
  padding: 0;
  white-space: pre;
}
</style>
