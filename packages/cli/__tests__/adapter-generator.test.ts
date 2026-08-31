/**
 * The adapter scaffold is the documentation adopters actually read.
 *
 * Its own comment promises "every lifecycle hook ... so adopters can browse
 * what's available", so a hook missing from it is a feature that effectively
 * does not exist. `onHealthCheck` was absent for several releases — and it is
 * the one with a built-in consumer, since `Application` aggregates every
 * adapter's check into `GET /health/ready`. Adopters wrote their own readiness
 * endpoints instead.
 *
 * @module @forinda/kickjs-cli/__tests__/adapter-generator.test
 */

import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { generateAdapter } from '../src/generators/adapter'

/** Every optional hook on `AppAdapter`. Add to this when the interface grows. */
const HOOKS = [
  'middleware',
  'contributors',
  'beforeMount',
  'onRouteMount',
  'beforeStart',
  'afterStart',
  'onHealthCheck',
  'shutdown',
  'introspect',
  'devtoolsTabs',
] as const

async function scaffold() {
  const dir = mkdtempSync(join(tmpdir(), 'kick-adapter-'))
  const [file] = await generateAdapter({ name: 'metrics', outDir: dir })
  return { dir, source: readFileSync(file, 'utf8') }
}

describe('kick g adapter', () => {
  it('emits every hook on AppAdapter', async () => {
    const { dir, source } = await scaffold()
    try {
      const missing = HOOKS.filter((h) => !new RegExp(`\\b${h}\\(`).test(source))
      expect(missing).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('names the consumer of each hook that has one', async () => {
    // A hook nobody can connect to an outcome gets deleted from the scaffold.
    const { dir, source } = await scaffold()
    try {
      expect(source).toContain('/health/ready')
      expect(source).toContain('DevTools')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not describe the middleware hook as Express-only', async () => {
    // The engine is pluggable; the scaffold said "Express middleware entries"
    // even on a project configured for Fastify or h3.
    const { dir, source } = await scaffold()
    try {
      expect(source).not.toMatch(/Express middleware entries/)
      expect(source).toMatch(/Connect-style middleware/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
