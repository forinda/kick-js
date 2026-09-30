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

import { scaffoldLayers, spaIntegration } from '../src/generators/project'
import { renderLayers } from '../src/scaffold/overlay'

/** The fullstack server's entry file: a minimal scaffold, plus SpaAdapter when given a dir. */
function generateEntry(packages: string[], clientDir?: string): string {
  const layers = scaffoldLayers({
    template: 'minimal',
    runtime: 'express',
    schemaLib: 'zod',
    packages,
  })
  const extra = clientDir === undefined ? [] : [spaIntegration(clientDir)]
  return renderLayers(layers, { extra, vars: { name: 'demo', version: '1.0.0' } }).files.get(
    'src/index.ts',
  )!
}

describe('fullstack entry wiring', () => {
  it('wires SpaAdapter when a client dir is given', () => {
    const entry = generateEntry([], '../web/dist')
    expect(entry).toContain("import { SpaAdapter } from '@forinda/kickjs/spa'")
    expect(entry).toContain('SpaAdapter({ clientDir: \"../web/dist\" })')
    expect(entry).toContain('adapters:')
  })

  it('says why it is safe in dev, next to the call', () => {
    // The inert-until-built behaviour is the whole reason this can be
    // unconditional; a reader deleting it "because dev serves via Vite"
    // would break production.
    const entry = generateEntry([], '../web/dist')
    expect(entry).toMatch(/Inert until/)
  })

  it('adds nothing when no client dir is given', () => {
    const entry = generateEntry([])
    expect(entry).not.toContain('SpaAdapter')
  })

  it('composes with other adapters rather than replacing them', () => {
    const entry = generateEntry(['swagger'], '../web/dist')
    expect(entry).toContain('SwaggerAdapter')
    expect(entry).toContain('SpaAdapter')
  })
})

describe('generated path is serialized, not interpolated', () => {
  it('escapes a quote in the client dir instead of breaking the file', () => {
    // The value is arbitrary caller-supplied path text written into a
    // TypeScript module. A raw `'${dir}'` template hole let a quote close the
    // string early and emit invalid TS — or worse, silently change the path.
    const entry = generateEntry([], "../we'b/dist")
    expect(entry).toContain('SpaAdapter({ clientDir: "../we\'b/dist" })')
    // The raw value must not reach the comment either.
    expect(entry).not.toContain("Inert until '../we'b/dist'")
  })

  it('escapes a backslash (Windows-style path)', () => {
    const entry = generateEntry([], '..\\web\\dist')
    expect(entry).toContain('SpaAdapter({ clientDir: "..\\\\web\\\\dist" })')
  })

  it('keeps the ordinary path readable', () => {
    const entry = generateEntry([], '../web/dist')
    expect(entry).toContain('SpaAdapter({ clientDir: "../web/dist" })')
  })
})
