/** The views `kick add views` scaffolds render as their comments say. */
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { createViews } from '../src/index'

const viewsDir = fileURLToPath(
  new URL('../../cli/templates/feature-views/files/src/views', import.meta.url),
)

describe('scaffolded views', () => {
  it("ctx.render('home') with no data still reads well", async () => {
    const views = createViews({ viewsDir, layout: 'layouts/main', warn: vi.fn() })
    expect(await views.render('home')).toContain('<h1>Hello from KickJS</h1>')
  })
})
