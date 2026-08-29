/**
 * Regression guard: a failed `npm view` must never fabricate a version.
 *
 * `resolveSiblingVersions()` used to fall back to the CLI's own version for
 * every sibling. Under independent versioning that names a release which does
 * not exist, so the scaffold installed clean and then died:
 *
 *   npm error 404 '@forinda/kickjs-vite@^6.14.1' is not in this registry
 *
 * The query is a network call — measured 0.6–3.6s per package against the
 * public registry — so the fallback path is reached in the wild, not just in
 * theory. It must yield something installable.
 *
 * @module @forinda/kickjs-cli/__tests__/scaffold-version-fallback.test
 */

import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const capture = vi.fn()

vi.mock('../src/utils/shell', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/utils/shell')>()),
  captureCommandAsync: (...args: unknown[]) => capture(...args),
}))

const { resolveSiblingVersions } = await import('../src/generators/project')
const cliVersion = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'))
  .version as string

describe('resolveSiblingVersions', () => {
  it('falls back to a resolvable range when npm view fails', async () => {
    capture.mockResolvedValue(null)

    const versions = await resolveSiblingVersions()

    for (const [name, range] of Object.entries(versions)) {
      if (name === '@forinda/kickjs-cli') {
        // The CLI's own version is the one pin that is genuinely correct.
        expect(range).toBe(`^${cliVersion}`)
      } else {
        expect(range).toBe('latest')
      }
    }
  })

  it('never pins a sibling to the CLI version', async () => {
    // The exact shape of the 404: every sibling wearing the CLI's version.
    capture.mockResolvedValue(null)

    const versions = await resolveSiblingVersions()
    const siblings = Object.entries(versions).filter(([n]) => n !== '@forinda/kickjs-cli')

    expect(siblings.length).toBeGreaterThan(0)
    expect(siblings.filter(([, r]) => r === `^${cliVersion}`)).toEqual([])
  })

  it('uses the published version when npm view answers', async () => {
    capture.mockResolvedValue('8.0.0')

    const versions = await resolveSiblingVersions()

    expect(versions['@forinda/kickjs-vite']).toBe('^8.0.0')
  })

  it('runs the queries concurrently, not serially', async () => {
    // `captureCommand` is execFileSync — `Promise.all` over it gives zero
    // concurrency, so the per-call timeout multiplies by the package count.
    let live = 0
    let peak = 0
    capture.mockImplementation(async () => {
      peak = Math.max(peak, ++live)
      await new Promise((r) => setTimeout(r, 10))
      live--
      return '1.0.0'
    })

    await resolveSiblingVersions()

    expect(peak).toBeGreaterThan(1)
  })
})
