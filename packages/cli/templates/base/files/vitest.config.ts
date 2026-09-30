import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

// A `vitest.config.ts` OVERRIDES `vite.config.ts` outright — vitest does not
// merge the two, and it never reads tsconfig `paths`. Restating settings here
// would mean the `@` alias lives in three files and drifts in two of them, so
// merge the real config instead: the alias, plugins, and ssr externals all come
// from one place.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: true,
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  }),
)
