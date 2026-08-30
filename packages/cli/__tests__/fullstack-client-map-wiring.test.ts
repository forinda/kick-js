/**
 * The fullstack template's web app reads the route map from the ambient
 * `KickClientApi` namespace. Nothing pinned that wiring before: deleting the
 * old `src/types/kick-routes.d.ts` bridge from the generator broke no test,
 * which is exactly the kind of silent template regression a scaffold user
 * finds instead of CI.
 *
 * @module @forinda/kickjs-cli/__tests__/fullstack-client-map-wiring.test
 */

import { describe, expect, it } from 'vitest'

import { webApi, webTsConfig } from '../src/generators/fullstack'

/** Statements only — the file comments the explicit-import alternative. */
const code = (out: string) =>
  out
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n')

describe('fullstack web wiring', () => {
  it('reads the map from the ambient namespace, with no import', () => {
    const api = webApi()

    expect(api).toContain('createClient<KickClientApi.Api>')
    // The bridge is gone: no import of the server's generated route types.
    expect(code(api)).not.toContain('kick__routes')
    expect(code(api)).not.toContain("from '../../server")
    // The only import is the client package itself.
    expect(code(api).match(/^import /gm)).toHaveLength(1)
  })

  it('registers the map as a global type package', () => {
    const cfg = JSON.parse(webTsConfig())

    expect(cfg.compilerOptions.types).toContain('../server/.kickjs/types/kick__client')
    // Extension omitted — a `types` entry is a package specifier, not a path
    // to a file, and including `.d.ts` makes it unresolvable.
    expect(cfg.compilerOptions.types.join()).not.toContain('.d.ts')
  })

  it('needs none of the settings the ambient bridge forced on it', () => {
    // The bridge dragged decorated server source into the web program; the
    // resolved map carries no reference to it, so these must not come back.
    const cfg = JSON.parse(webTsConfig())

    expect(cfg.compilerOptions.experimentalDecorators).toBeUndefined()
    expect(cfg.compilerOptions.emitDecoratorMetadata).toBeUndefined()
    expect(cfg.compilerOptions.paths).toBeUndefined()
  })
})
