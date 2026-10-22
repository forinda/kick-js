import { defineConfig } from 'vitest/config'
import base from './vitest.config'

// The base config's plugins and aliases, but only the benchmark.
export default defineConfig({ ...base, test: { ...base.test, include: ['bench/**/*.bench.ts'] } })
