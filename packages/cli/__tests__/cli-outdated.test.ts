/** `kick new` warns when the running CLI is behind the latest release. */
import { describe, expect, it, vi } from 'vitest'

const capture = vi.fn()

vi.mock('../src/utils/shell', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/utils/shell')>()),
  captureCommandAsync: (...args: unknown[]) => capture(...args),
}))

const { cliVersion, isBehind, newerCliRelease } = await import('../src/generators/project')
const [major] = cliVersion.split('.').map(Number)

describe('newerCliRelease', () => {
  it('names the latest release when this CLI is behind it', async () => {
    capture.mockResolvedValue(`${major! + 1}.0.0`)
    expect(await newerCliRelease()).toBe(`${major! + 1}.0.0`)
  })

  it('is null when this CLI is current, newer, or npm gives nothing', async () => {
    capture.mockResolvedValue(cliVersion)
    expect(await newerCliRelease()).toBeNull()
    capture.mockResolvedValue('0.0.1')
    expect(await newerCliRelease()).toBeNull()
    capture.mockResolvedValue(null)
    expect(await newerCliRelease()).toBeNull()
  })

  it('orders releases, a prerelease behind its stable', () => {
    expect(isBehind('8.13.1', '8.14.0')).toBe(true)
    expect(isBehind('8.14.0-rc.1', '8.14.0')).toBe(true)
    expect(isBehind('8.14.0', '8.14.0')).toBe(false)
    expect(isBehind('8.14.0', '8.14.0-rc.1')).toBe(false)
    expect(isBehind('9.0.0-alpha.1', '8.14.0')).toBe(false)
  })
})
