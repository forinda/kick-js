import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { build } from 'vite'
import { describe, expect, it, vi } from 'vitest'

// A view package from before disk files (no `useClientFiles`) can't serve them.
vi.doMock('@forinda/kickjs-view', async (importOriginal) => {
  const { useClientFiles: _gone, ...rest } = await importOriginal<Record<string, unknown>>()
  return rest
})

describe('an older @forinda/kickjs-view', () => {
  it('fails a disk-mode build with a clear message', async () => {
    const { kickViewsPlugin } = await import('../src/kick-views-plugin')
    const root = mkdtempSync(join(tmpdir(), 'kick-views-old-'))
    const files = {
      'entry.ts': "export { default } from 'virtual:kick-views'",
      'src/views/components/a-b.kick': '<div></div>\n<script client>\nconsole.log(1)\n</script>',
    }
    for (const [name, src] of Object.entries(files)) {
      mkdirSync(dirname(join(root, name)), { recursive: true })
      writeFileSync(join(root, name), src)
    }
    await expect(
      build({
        root,
        configFile: false,
        logLevel: 'silent',
        plugins: [kickViewsPlugin()],
        build: { ssr: join(root, 'entry.ts'), write: false },
      }),
    ).rejects.toThrow(/@forinda\/kickjs-view 0\.3 or later/)
  })
})
