/**
 * `kick add` wiring: a layer's integrations spliced into the user's existing
 * entry file, leaving everything else in it untouched.
 */
import { describe, expect, it } from 'vitest'

import { addImport, wireIntegrations } from '../src/scaffold/wire'
import type { Integration } from '../src/scaffold/overlay'

const swagger: Integration = {
  import: { from: '@forinda/kickjs-swagger', names: ['SwaggerAdapter'] },
  slot: 'adapter',
  code: "SwaggerAdapter({ info: { title: '{{name}}' } })",
}
const ws: Integration = {
  import: { from: '@forinda/kickjs-ws', names: ['WsAdapter'] },
  slot: 'adapter',
  code: "// WebSocket upgrades on /ws.\nWsAdapter({ path: '/ws' })",
}
const fill = (text: string) => text.replace('{{name}}', 'demo')

describe('wireIntegrations', () => {
  it('appends to an existing adapters array and adds the import', () => {
    const source = [
      "import { bootstrap } from '@forinda/kickjs'",
      "import { modules } from './modules'",
      '',
      '// my comment stays',
      'export const app = await bootstrap({',
      '  modules,',
      '  adapters: [',
      '    MyAdapter(),',
      '  ],',
      '})',
      '',
    ].join('\n')
    const out = wireIntegrations(source, [swagger, ws], fill)
    expect(out.added).toEqual(['SwaggerAdapter', 'WsAdapter'])
    expect(out.source).toBe(
      [
        "import { bootstrap } from '@forinda/kickjs'",
        "import { modules } from './modules'",
        "import { SwaggerAdapter } from '@forinda/kickjs-swagger'",
        "import { WsAdapter } from '@forinda/kickjs-ws'",
        '',
        '// my comment stays',
        'export const app = await bootstrap({',
        '  modules,',
        '  adapters: [',
        '    MyAdapter(),',
        "    SwaggerAdapter({ info: { title: 'demo' } }),",
        '    // WebSocket upgrades on /ws.',
        "    WsAdapter({ path: '/ws' }),",
        '  ],',
        '})',
        '',
      ].join('\n'),
    )
  })

  it('handles a last element without a trailing comma, and an empty array', () => {
    const noComma = 'bootstrap({\n  adapters: [\n    A()\n  ],\n})\n'
    expect(wireIntegrations(noComma, [{ slot: 'adapter', code: 'B()' }]).source).toBe(
      'bootstrap({\n  adapters: [\n    A(),\n    B()\n  ],\n})\n',
    )
    const empty = 'bootstrap({\n  modules,\n  adapters: [],\n})\n'
    expect(wireIntegrations(empty, [{ slot: 'adapter', code: 'B()' }]).source).toBe(
      'bootstrap({\n  modules,\n  adapters: [\n    B(),\n  ],\n})\n',
    )
  })

  it('creates the adapters array when the options have none', () => {
    const multi = 'await bootstrap({\n  modules,\n  runtime: expressRuntime(),\n})\n'
    expect(wireIntegrations(multi, [{ slot: 'adapter', code: 'B()' }]).source).toBe(
      'await bootstrap({\n  modules,\n  runtime: expressRuntime(),\n  adapters: [\n    B(),\n  ],\n})\n',
    )
    // One-line options (the old minimal template): still valid TS.
    const oneLine = 'await bootstrap({ modules, runtime: expressRuntime() })\n'
    const out = wireIntegrations(oneLine, [{ slot: 'adapter', code: 'B()' }]).source
    expect(out).toContain('adapters: [')
    expect(out).toContain('B(),')
    expect(out).toMatch(/runtime: expressRuntime\(\),\n/)
  })

  it('is idempotent', () => {
    const once = wireIntegrations('bootstrap({\n  modules,\n})\n', [swagger], fill)
    const twice = wireIntegrations(once.source, [swagger], fill)
    expect(twice.added).toEqual([])
    expect(twice.present).toHaveLength(1)
    expect(twice.source).toBe(once.source)
  })

  it('recognises an adapter imported under another name', () => {
    const source = [
      "import { SwaggerAdapter as SA } from '@forinda/kickjs-swagger'",
      'bootstrap({',
      '  adapters: [',
      '    SA(),',
      '  ],',
      '})',
      '',
    ].join('\n')
    const out = wireIntegrations(source, [swagger], fill)
    expect(out.present).toEqual(['SwaggerAdapter'])
    expect(out.source).toBe(source)
  })

  it('returns entries it cannot place, rather than guessing', () => {
    const noBootstrap = 'export const app = createApp({ modules })\n'
    expect(wireIntegrations(noBootstrap, [swagger], fill).manual).toHaveLength(1)
    const referenced = 'bootstrap({\n  modules,\n  adapters,\n})\n'
    const out = wireIntegrations(referenced, [swagger], fill)
    expect(out.manual.map((m) => m.code)).toEqual(["SwaggerAdapter({ info: { title: 'demo' } })"])
    expect(out.source).toBe(referenced)
  })

  it('adds middleware entries to middlewares', () => {
    const src = 'bootstrap({\n  middlewares: [\n    cors(),\n  ],\n})\n'
    expect(wireIntegrations(src, [{ slot: 'middleware', code: 'x()' }]).source).toContain(
      '    cors(),\n    x(),\n',
    )
  })
})

describe('addImport', () => {
  it('merges into an existing import from the same module', () => {
    expect(
      addImport("import { bootstrap } from '@forinda/kickjs'\n", {
        from: '@forinda/kickjs',
        names: ['cors', 'bootstrap'],
      }),
    ).toBe("import { bootstrap, cors } from '@forinda/kickjs'\n")
  })

  it('adds a separate import next to a side-effect import of the module', () => {
    expect(
      addImport("import '@forinda/kickjs-swagger'\n", {
        from: '@forinda/kickjs-swagger',
        names: ['SwaggerAdapter'],
      }),
    ).toBe(
      "import '@forinda/kickjs-swagger'\nimport { SwaggerAdapter } from '@forinda/kickjs-swagger'\n",
    )
  })

  it('adds named imports next to a default import, and skips type-only imports', () => {
    expect(addImport("import express from 'express'\n", { from: 'express', names: ['json'] })).toBe(
      "import express, { json } from 'express'\n",
    )
    expect(addImport("import type { X } from 'x'\n", { from: 'x', names: ['Y'] })).toBe(
      "import type { X } from 'x'\nimport { Y } from 'x'\n",
    )
  })
})
