/**
 * The engines and their plugins load through `import`, never `createRequire`.
 * `kick build:netlify|vercel` bundles the app into one file, and a bundler
 * inlines what an import names but leaves a computed `require('fastify')` for
 * the platform — where the function has no node_modules, so it failed with
 * "Cannot find module 'fastify'" (and 'h3', 'multer', 'serve-static').
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const files = [
  'http/runtimes/fastify.ts',
  'http/runtimes/h3.ts',
  'http/runtimes/lazy-serve-static.ts',
  'http/middleware/upload.ts',
]

it.each(files)('%s loads its peers through import', (file) => {
  const source = readFileSync(join(import.meta.dirname, '../src', file), 'utf-8')
  expect(source).not.toMatch(/createRequire\(|peerRequire\(|loadPeer\(/)
})
