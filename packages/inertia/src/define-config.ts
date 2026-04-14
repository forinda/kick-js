import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { InertiaConfig } from './types'

const DEFAULT_MANIFEST_PATHS = [
  'build/client/.vite/manifest.json',
  'dist/client/.vite/manifest.json',
]

function defaultVersion(): string {
  for (const relPath of DEFAULT_MANIFEST_PATHS) {
    const absPath = resolve(relPath)
    if (existsSync(absPath)) {
      const content = readFileSync(absPath, 'utf-8')
      return createHash('md5').update(content).digest('hex').slice(0, 8)
    }
  }
  return 'dev'
}

export function defineInertiaConfig(config: InertiaConfig): Required<InertiaConfig> {
  return {
    rootView: config.rootView,
    version: config.version ?? defaultVersion,
    ssr: {
      enabled: config.ssr?.enabled ?? false,
      entrypoint: config.ssr?.entrypoint ?? 'src/ssr.tsx',
      bundle: config.ssr?.bundle,
    },
    share: config.share ?? (() => ({})),
  }
}
