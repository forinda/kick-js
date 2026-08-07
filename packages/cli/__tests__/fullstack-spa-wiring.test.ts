/**
 * The fullstack template builds `web/` to `web/dist` and, before this, nothing
 * ever served it: the generated server bootstrap had no adapters and the root
 * had no `start` script. `pnpm build` produced a frontend the API had no way to
 * hand out, so every deploy needed a hand-wired static host or a second process.
 *
 * `SpaAdapter` closes that, and costs nothing in dev: it is inert while
 * `../web/dist` does not exist, which is the normal state under `kick dev`
 * where Vite serves the client and proxies `/api` to the server.
 */
import { describe, it, expect } from 'vitest'

import { generateEntryFile } from '../src/generators/templates/project-app'

describe('fullstack entry wiring', () => {
  it('wires SpaAdapter when a client dir is given', () => {
    const entry = generateEntryFile('demo', 'minimal', '1.0.0', [], 'express', '../web/dist')
    expect(entry).toContain("import { SpaAdapter } from '@forinda/kickjs/spa'")
    expect(entry).toContain("SpaAdapter({ clientDir: '../web/dist' })")
    expect(entry).toContain('adapters:')
  })

  it('says why it is safe in dev, next to the call', () => {
    // The inert-until-built behaviour is the whole reason this can be
    // unconditional; a reader deleting it "because dev serves via Vite"
    // would break production.
    const entry = generateEntryFile('demo', 'minimal', '1.0.0', [], 'express', '../web/dist')
    expect(entry).toMatch(/Inert until/)
  })

  it('adds nothing when no client dir is given', () => {
    const entry = generateEntryFile('demo', 'minimal', '1.0.0', [], 'express')
    expect(entry).not.toContain('SpaAdapter')
  })

  it('composes with other adapters rather than replacing them', () => {
    const entry = generateEntryFile(
      'demo',
      'minimal',
      '1.0.0',
      ['swagger'],
      'express',
      '../web/dist',
    )
    expect(entry).toContain('SwaggerAdapter')
    expect(entry).toContain('SpaAdapter')
  })
})
