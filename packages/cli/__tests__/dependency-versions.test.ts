/**
 * Third-party ranges are resolved at scaffold time, not pinned in the CLI.
 * A pin means every React or Vitest release needs a CLI release to reach new
 * projects — and the two templates drifted apart while pinned (the web app
 * shipped vite ^7 against a server on ^8).
 *
 * Engine, schema and toolchain packages stay capped to the major the
 * generated code is written against; everything else tracks latest.
 */
import { describe, expect, it, vi } from 'vitest'

const capture = vi.fn()

vi.mock('../src/utils/shell', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/utils/shell')>()),
  captureCommandAsync: (...args: unknown[]) => capture(...args),
}))

const { parseNpmVersion, resolveSiblingVersions } = await import('../src/generators/project')
const { generatePackageJson } = await import('../src/generators/templates/project-config')

describe('parseNpmVersion', () => {
  it('reads the single version npm prints for a dist-tag query', () => {
    expect(parseNpmVersion('19.3.0\n')).toBe('19.3.0')
  })

  it('takes the newest match from the JSON list a range query prints', () => {
    expect(parseNpmVersion('[\n  "5.1.0",\n  "5.2.0",\n  "5.2.1"\n]')).toBe('5.2.1')
    // One match comes back as a bare JSON string, not a list.
    expect(parseNpmVersion('"4.6.5"')).toBe('4.6.5')
  })

  it('reports nothing rather than guessing when the query failed', () => {
    expect(parseNpmVersion(null)).toBeNull()
    expect(parseNpmVersion('npm error code E404')).toBeNull()
  })
})

describe('resolveSiblingVersions', () => {
  it('asks the registry for third-party packages, capping the ones that must not jump a major', async () => {
    capture.mockResolvedValue('9.9.9')
    await resolveSiblingVersions()

    const specs = capture.mock.calls.map(([, args]) => (args as string[])[1])
    // Uncapped: whatever `latest` is.
    expect(specs).toContain('react')
    expect(specs).toContain('vitest')
    // Capped: the generated code is written against this major.
    expect(specs).toContain('vite@^8')
    expect(specs).toContain('express@^5')
    expect(specs).toContain('zod@^4')
    // Capped queries need --json: npm prints every match, not one version.
    const capped = capture.mock.calls.find(([, args]) => (args as string[])[1] === 'vite@^8')
    expect(capped?.[1]).toContain('--json')
  })

  it('falls back to a range that installs when the registry says nothing', async () => {
    capture.mockResolvedValue(null)
    const versions = await resolveSiblingVersions()

    expect(versions.react).toMatch(/^\^\d+\.\d+\.\d+$/)
    expect(versions.vite).toMatch(/^\^\d+\.\d+\.\d+$/)
  })
})

describe('generated package.json', () => {
  it('writes the resolved range for every third-party dependency', async () => {
    capture.mockImplementation(async (_cmd: string, args: string[]) => {
      const spec = args[1]!
      // A capped query answers with a list, a latest query with one version.
      return spec.includes('@^') ? '["1.2.3"]' : '1.2.3'
    })
    const versions = await resolveSiblingVersions()
    const pkg = JSON.parse(generatePackageJson('demo-app', 'minimal', versions))

    const ranges = { ...pkg.dependencies, ...pkg.devDependencies }
    for (const [name, range] of Object.entries(ranges)) {
      expect(range, `${name} should carry the resolved range`).toBe('^1.2.3')
    }
  })
})

describe('registry budget', () => {
  it('stops probing once the budget is spent and takes the fallbacks', async () => {
    vi.useFakeTimers()
    try {
      const { VERSION_LOOKUP_BUDGET_MS } = await import('../src/generators/project')
      capture.mockReset()
      // Every probe burns the whole budget, as a stalled registry would.
      capture.mockImplementation(async () => {
        vi.setSystemTime(Date.now() + VERSION_LOOKUP_BUDGET_MS)
        return null
      })

      const versions = await resolveSiblingVersions()

      // 8 workers each get one probe in; the remaining ~29 take fallbacks
      // instead of waiting for another timeout.
      expect(capture.mock.calls.length).toBeLessThanOrEqual(8)
      expect(Object.keys(versions).length).toBeGreaterThan(30)
      expect(versions.react).toMatch(/^\^\d+\.\d+\.\d+$/)
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives each probe only the time left in the budget', async () => {
    capture.mockReset()
    capture.mockResolvedValue('1.2.3')
    await resolveSiblingVersions()

    for (const call of capture.mock.calls) {
      const options = call[2] as { timeout: number }
      expect(options.timeout).toBeGreaterThan(0)
      expect(options.timeout).toBeLessThanOrEqual(20_000)
    }
  })
})
