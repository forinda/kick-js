import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// Vite 6 and 7 have no transformWithOxc: the plugin must still load and strip.
vi.mock('vite', async (original) => {
  const { transformWithOxc: _gone, ...rest } = await original<typeof import('vite')>()
  return rest
})

describe('kickViewsPlugin on Vite without transformWithOxc', () => {
  it('strips client scripts with the esbuild transform instead', async () => {
    const { kickViewsPlugin } = await import('../src/kick-views-plugin')
    const root = mkdtempSync(join(tmpdir(), 'kick-views-old-'))
    const file = join(root, 'src/views/components/flash-toast.kick')
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(
      file,
      "<kick-toast>hi</kick-toast>\n<script client>\nconst n: number = 1\ncustomElements.define('kick-toast', class extends HTMLElement {})\n</script>",
    )
    const plugin = kickViewsPlugin({ clientFiles: 'bundle' }) as any
    plugin.configResolved({ root, command: 'build' })
    const ctx = {
      addWatchFile: () => {},
      warn: () => {},
      error: (m: string) => {
        throw new Error(m)
      },
    }
    await plugin.buildStart.call(ctx)
    const code: string = await plugin.load.call(ctx, plugin.resolveId('virtual:kick-views'))
    expect(code).toMatch(/"js": ?true/)
    expect(code).toContain('customElements.define(')
    expect(code).not.toContain(': number')
  })
})
