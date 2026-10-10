/**
 * Overlay scaffolding: layers are directories under `templates/`, rendered in
 * order into project paths. `_dot_` segment prefixes become dotfiles, so
 * `.gitignore` and friends survive npm publish; `.append` files extend a file
 * from an earlier layer; `feature.json` integrations fill the slots that
 * shared files mark with `// @kick:<slot>`.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { SIBLING_PACKAGES, THIRD_PARTY_PACKAGES, scaffoldLayers } from '../src/generators/project'
import {
  TEMPLATES_DIR,
  fillVars,
  outputPath,
  renderImports,
  renderLayers,
  renderSlots,
} from '../src/scaffold/overlay'

describe('outputPath', () => {
  it('turns a _dot_ prefix into a dot in any segment', () => {
    expect(outputPath('_dot_gitignore')).toBe('.gitignore')
    expect(outputPath('_dot_env.test.example')).toBe('.env.test.example')
    expect(outputPath('_dot_vscode/_dot_hidden/settings.json')).toBe(
      '.vscode/.hidden/settings.json',
    )
    expect(outputPath('src/not_dot_file.ts')).toBe('src/not_dot_file.ts')
  })
})

describe('renderLayers', () => {
  let root: string
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const write = (path: string, contents: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), contents)
  }

  it('renders layers in order: later files replace, .append files extend', () => {
    root = mkdtempSync(join(tmpdir(), 'kick-layers-'))
    write('one/files/src/a.ts', 'a from one')
    write('one/files/_dot_env', 'PORT=3000\n')
    write('two/files/src/a.ts', 'a from two')
    write('two/files/src/deep/b.ts', 'b')
    write('two/files/_dot_env.append', 'REDIS_HOST=127.0.0.1\n')
    write('two/files/_dot_new.append', 'created\n')

    const { files } = renderLayers(['one', 'two'], { templatesDir: root })
    expect(Object.fromEntries(files)).toEqual({
      '.env': 'PORT=3000\nREDIS_HOST=127.0.0.1\n',
      '.new': 'created\n',
      'src/a.ts': 'a from two',
      'src/deep/b.ts': 'b',
    })
  })

  it('collects package lists from feature.json, without duplicates, and fills slots', () => {
    root = mkdtempSync(join(tmpdir(), 'kick-layers-'))
    write('app/files/index.ts', '// @kick:imports\nrun([\n  // @kick:item\n])\n')
    write('app/feature.json', JSON.stringify({ dependencies: ['a'], devDependencies: ['t'] }))
    write(
      'x/feature.json',
      JSON.stringify({
        dependencies: ['a', 'b'],
        integrations: [
          { import: { from: 'x', names: ['X'] }, slot: 'item', code: "X('{{name}}')" },
        ],
      }),
    )

    const project = renderLayers(['app', 'x'], { templatesDir: root, vars: { name: 'demo' } })
    expect(project.dependencies).toEqual(['a', 'b'])
    expect(project.devDependencies).toEqual(['t'])
    expect(project.files.get('index.ts')).toBe("import { X } from 'x'\nrun([\n  X('demo'),\n])\n")
  })

  it('accepts a layer with only a feature.json, and fails on an unknown layer', () => {
    root = mkdtempSync(join(tmpdir(), 'kick-layers-'))
    write('meta/feature.json', JSON.stringify({ dependencies: ['a'] }))
    expect(renderLayers(['meta'], { templatesDir: root }).dependencies).toEqual(['a'])
    expect(() => renderLayers(['nope'], { templatesDir: root })).toThrow(
      'Unknown scaffold layer "nope"',
    )
  })
})

describe('renderSlots', () => {
  const file = [
    '// @kick:imports',
    'boot({',
    '  // @kick:runtime',
    '  adapters: [',
    '    // @kick:adapter',
    '  ],',
    '  middlewares: [',
    '    a(),',
    '    // @kick:middleware',
    '  ],',
    '})',
  ].join('\n')

  it('drops an empty slot block, and the imports of slots the file lacks', () => {
    const out = renderSlots(file, [
      { import: { from: 'k', names: ['boot'] } },
      { import: { from: 'k', names: ['rt'] }, slot: 'runtime', code: 'runtime: rt()' },
      { import: { from: 'q', names: ['Q'] }, slot: 'queue', code: 'Q()' },
    ])
    expect(out).toBe(
      [
        "import { boot, rt } from 'k'",
        'boot({',
        '  runtime: rt(),',
        '  middlewares: [',
        '    a(),',
        '  ],',
        '})',
      ].join('\n'),
    )
  })

  it('indents multi-line entries and keeps their order', () => {
    const out = renderSlots(file, [
      { slot: 'adapter', code: '// first\nA()' },
      { slot: 'adapter', code: 'B({\n  x: 1,\n})' },
    ])
    expect(out).toContain(
      [
        '  adapters: [',
        '    // first',
        '    A(),',
        '    B({',
        '      x: 1,',
        '    }),',
        '  ],',
      ].join('\n'),
    )
  })
})

describe('renderImports', () => {
  it('merges names per module, keeps a default import, and wraps long lines', () => {
    expect(
      renderImports([
        { from: 'k', names: ['a', 'b'] },
        { from: 'express', default: 'express' },
        { from: 'k', names: ['b', 'c'] },
      ]),
    ).toEqual(["import { a, b, c } from 'k'", "import express from 'express'"])

    const long = Array.from({ length: 12 }, (_, i) => `longIdentifierName${i}`)
    const [line] = renderImports([{ from: '@forinda/kickjs', names: long }])
    expect(line).toBe(
      `import {\n${long.map((n) => `  ${n},`).join('\n')}\n} from '@forinda/kickjs'`,
    )
  })
})

describe('the shipped layers', () => {
  const layers = readdirSync(TEMPLATES_DIR)

  it('leave no markers or {{vars}} in the fullstack root and web layers', () => {
    const files = fillVars(renderLayers(['fullstack-root', 'web-kick']).files, {
      name: 'demo',
      packageManager: 'pnpm',
    })
    for (const [path, contents] of files) {
      expect(contents, path).not.toMatch(/@kick:|\{\{\w+\}\}/)
    }
    expect(files.get('web/index.html')).toContain('<title>demo</title>')
    expect(files.get('netlify.toml')).toContain('pnpm run build:netlify')
  })

  it('only list packages the scaffold resolves a version for', () => {
    const resolvable = new Set<string>([...SIBLING_PACKAGES, ...Object.keys(THIRD_PARTY_PACKAGES)])
    const project = renderLayers(layers.filter((l) => !l.startsWith('template-')))
    for (const name of [...project.dependencies, ...project.devDependencies]) {
      expect(resolvable.has(name), `${name} has no version source`).toBe(true)
    }
  })

  it('leave no slot markers or {{vars}} in any combination', () => {
    for (const template of ['minimal', 'rest'] as const) {
      for (const runtime of ['express', 'fastify', 'h3'] as const) {
        const project = renderLayers(
          [
            ...scaffoldLayers({
              template,
              runtime,
              schemaLib: 'zod',
              packages: ['swagger', 'devtools', 'ws', 'queue'],
            }),
            'host-config',
            'server-fullstack',
          ],
          { vars: { name: 'demo', version: '1.0.0' } },
        )
        // The vars `kick new` fills after rendering.
        const files = fillVars(project.files, {
          name: 'demo',
          template,
          runtime,
          packageManager: 'pnpm',
          templateLabel: 'Minimal',
          packages: '- `@forinda/kickjs`',
        })
        for (const [path, contents] of files) {
          expect(contents, `${template}/${runtime}: ${path}`).not.toMatch(/@kick:|\{\{\w+\}\}/)
        }
      }
    }
  })

  it('wire the runtime, and the body parser only where there is a middleware list', () => {
    const entry = (template: 'minimal' | 'rest', runtime: 'express' | 'fastify' | 'h3') =>
      renderLayers(scaffoldLayers({ template, runtime, schemaLib: 'zod', packages: [] })).files.get(
        'src/index.ts',
      )!

    expect(entry('rest', 'express')).toContain("import express from 'express'")
    expect(entry('rest', 'express')).toContain('express.json(),')
    expect(entry('minimal', 'express')).not.toContain("from 'express'")
    expect(entry('minimal', 'express')).toContain('runtime: expressRuntime(),')
    expect(entry('rest', 'fastify')).toContain(
      "import { fastifyRuntime } from '@forinda/kickjs/fastify'",
    )
    expect(entry('rest', 'fastify')).not.toMatch(/express/i)
    expect(entry('minimal', 'h3')).toContain('runtime: h3Runtime(),')
    // No adapters picked: no empty `adapters: []`.
    expect(entry('minimal', 'express')).not.toContain('adapters')
  })

  it('wire every optional package into the adapters list, with its peers installed', () => {
    const project = renderLayers(
      scaffoldLayers({
        template: 'minimal',
        runtime: 'express',
        schemaLib: 'zod',
        packages: ['swagger', 'devtools', 'ws', 'queue'],
      }),
      { vars: { name: 'demo', version: '1.2.3' } },
    )
    const entry = project.files.get('src/index.ts')!
    expect(entry).toContain("SwaggerAdapter({ info: { title: 'demo', version: '1.2.3' } }),")
    expect(entry).toContain('DevToolsAdapter(),')
    expect(entry).toContain("WsAdapter({ path: '/ws' }),")
    expect(entry).toContain('QueueAdapter({')
    expect(project.dependencies).toEqual(
      expect.arrayContaining([
        '@forinda/kickjs-ws',
        'ws',
        '@forinda/kickjs-queue',
        'bullmq',
        'ioredis',
      ]),
    )
    expect(project.files.get('.env')).toContain('REDIS_HOST=127.0.0.1')
    expect(project.files.get('.env.example')).toContain('REDIS_PORT=6379')
  })

  it('answer the install scripts their packages bring in', () => {
    // pnpm 10+ fails the install on an unanswered build script.
    const { builds } = renderLayers(['feature-swagger', 'feature-queue'])
    expect(builds).toEqual({ '@scarf/scarf': true, 'msgpackr-extract': false })
  })

  it('ship one env schema per schema library', () => {
    for (const lib of ['zod', 'valibot', 'yup'] as const) {
      const project = renderLayers([`schema-${lib}`])
      expect(project.files.get('src/config/index.ts')).toContain(`from '${lib}'`)
      // Valibot's JSON Schema converter ships with it — Swagger reads Valibot schemas through it.
      expect(project.dependencies).toEqual(
        lib === 'valibot' ? ['valibot', '@valibot/to-json-schema'] : [lib],
      )
    }
  })
})
