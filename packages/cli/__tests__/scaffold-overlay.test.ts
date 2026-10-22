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

import {
  SIBLING_PACKAGES,
  THIRD_PARTY_PACKAGES,
  commandVars,
  scaffoldLayers,
} from '../src/generators/project'
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

  it('imports only the names the rendered file uses', () => {
    const test = [
      "import { Adapter } from 'k'",
      '// @kick:imports',
      'createTestApp({',
      '  // @kick:runtime',
      '  adapters: [Adapter()],',
      '})',
    ].join('\n')
    const out = renderSlots(test, [
      { import: { from: 'k', names: ['boot', 'getEnv', 'Adapter'] } },
      {
        import: { from: 'k/h3', names: ['h3Runtime'] },
        slot: 'runtime',
        code: 'runtime: h3Runtime()',
      },
    ])
    expect(out).toBe(
      [
        "import { Adapter } from 'k'",
        "import { h3Runtime } from 'k/h3'",
        'createTestApp({',
        '  runtime: h3Runtime(),',
        '  adapters: [Adapter()],',
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
    const files = fillVars(
      renderLayers(['fullstack-root', 'web-kick', 'deploy-netlify-workspace']).files,
      {
        name: 'demo',
        packageManager: 'pnpm',
      },
    )
    for (const [path, contents] of files) {
      expect(contents, path).not.toMatch(/@kick:|\{\{\w+\}\}/)
    }
    expect(files.get('web/index.html')).toContain('<title>demo</title>')
    expect(files.get('netlify.toml')).toContain('pnpm run build:netlify')
  })

  it('install the ws peer of devtools as a dev dependency', () => {
    const project = renderLayers(
      scaffoldLayers({
        template: 'minimal',
        runtime: 'express',
        schemaLib: 'zod',
        packages: ['devtools'],
      }),
    )
    expect(project.devDependencies).toEqual(
      expect.arrayContaining(['@forinda/kickjs-devtools', 'ws']),
    )
    expect(project.dependencies).not.toContain('ws')
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
            'deploy-netlify',
            'deploy-vercel',
            'deploy-serverless',
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
          ...commandVars('pnpm'),
          netlifyPublish: 'dist/public',
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
    // DevTools is dev-only: a flag-gated dynamic import, never a static one.
    expect(entry).toContain('...(__KICKJS_DEVTOOLS__')
    expect(entry).toContain("? [(await import('@forinda/kickjs-devtools')).DevToolsAdapter()]")
    expect(entry).not.toMatch(/import \{[^}]*DevToolsAdapter[^}]*\} from/)
    expect(project.devDependencies).toContain('@forinda/kickjs-devtools')
    expect(project.dependencies).not.toContain('@forinda/kickjs-devtools')
    // Its `ws` peer comes with it (yarn 1 doesn't install peers) — here WsAdapter
    // needs ws at runtime, so it's a dependency and only that.
    expect(project.devDependencies).not.toContain('ws')
    expect(project.files.get('src/devtools.d.ts')).toMatch(
      /^\/\/\/ <reference types="@forinda\/kickjs-vite\/globals" \/>$/m,
    )
    expect(entry).toContain("WsAdapter({ path: '/ws' }),")
    expect(entry).toContain('queueAdapter(),')
    expect(project.files.get('src/config/index.ts')).toContain(
      "REDIS_HOST: z.string().default('127.0.0.1'),",
    )
    expect(project.dependencies).toEqual(
      expect.arrayContaining([
        '@forinda/kickjs-ws',
        'ws',
        '@forinda/kickjs-queue',
        'bullmq',
        'ioredis',
      ]),
    )
    expect(project.files.get('.env.example')).toContain('# REDIS_PORT=6379')
  })

  it('never import an env object or read env.KEY in any template', () => {
    for (const template of ['minimal', 'rest', 'inertia'] as const) {
      for (const lib of ['zod', 'valibot', 'yup'] as const) {
        const { files } = renderLayers(
          scaffoldLayers({
            template,
            runtime: 'express',
            schemaLib: lib,
            packages: ['swagger', 'devtools', 'ws', 'queue', 'storage'],
          }),
        )
        for (const [path, contents] of files) {
          if (!/\.(?:[cm]?[jt]sx?)$/.test(path)) continue
          expect(contents, path).not.toMatch(/import \{[^}]*\benv\b[^}]*\}/)
          expect(contents, path).not.toMatch(/(?<![\w.])env\.[A-Z][A-Z0-9_]*/)
          expect(contents, path).not.toMatch(/export const env\b/)
        }
      }
    }
  })

  it('answer the install scripts their packages bring in', () => {
    // pnpm 10+ fails the install on an unanswered build script.
    const { builds } = renderLayers(['feature-swagger', 'feature-queue'])
    expect(builds).toEqual({ '@scarf/scarf': true, 'msgpackr-extract': false })
  })

  it('render the inertia template as one app: pages, client, SSR and the build that makes them', () => {
    const project = renderLayers(
      scaffoldLayers({ template: 'inertia', runtime: 'express', schemaLib: 'zod', packages: [] }),
    )
    const entry = project.files.get('src/index.ts')!
    // The Express body parser lands in the middleware list the template declares.
    expect(entry).toMatch(
      /middlewares: \[\n\s+requestId\(\),[\s\S]*express\.json\(\),[\s\S]*session\(/,
    )
    expect(entry).toContain(
      "import { InertiaAdapter, h, inertiaErrorHandler, inertiaNotFound } from '@forinda/kickjs-inertia'",
    )
    expect(entry).toContain('onError: inertiaErrorHandler()')
    expect(entry).toContain('onNotFound: inertiaNotFound()')
    expect(entry).toContain('notFoundFallthrough: false')

    for (const path of [
      'src/modules/pages/pages.controller.ts',
      'src/client/main.tsx',
      'src/client/ssr.tsx',
      'vite.client.config.ts',
      'public/favicon.svg',
      'src/client/pages/Error.tsx',
      'src/client/Seo.tsx',
      'src/modules/seo/seo.controller.ts',
    ]) {
      expect(project.files.has(path), path).toBe(true)
    }
    expect(project.files.get('tsconfig.json')).toContain('"jsx": "react-jsx"')
    expect(project.files.get('vite.config.ts')).toContain('react()')
    expect(project.scripts.build).toContain('--ssr src/client/ssr.tsx')
    // `kick g deploy` builds the platform scripts on this one, so they build
    // the client manifest the adapter reads at startup (deploy-generator.test.ts).
    expect(project.files.get('.env')).toContain('SESSION_SECRET={{sessionSecret}}')
    // SESSION_SECRET is in the env schema. The dev-only default is accepted only
    // under NODE_ENV 'development' or 'test' — an unset NODE_ENV fails closed.
    const config = project.files.get('src/config/index.ts')!
    expect(config).toMatch(
      /SESSION_SECRET: z\n\s+\.string\(\)\n\s+\.min\(32\)\n\s+\.default\('dev-only-/,
    )
    expect(config).toMatch(
      /\['development', 'test'\]\.includes\(process\.env\.NODE_ENV \?\? ''\) \|\|\n\s+!s\.startsWith\('dev-only-'\)/,
    )
    expect(config).not.toContain('@kick:')
    // SEO: APP_URL fails closed like SESSION_SECRET, and is the adapter's baseUrl.
    expect(config).toMatch(/APP_URL: z\n\s+\.url\(\)\n\s+\.default\('http:\/\/localhost:3000'\)/)
    expect(config).toContain('process.env.APP_URL !== undefined')
    expect(project.files.get('.env')).toContain('APP_URL=http://localhost:3000')
    expect(entry).toContain("baseUrl: getEnv('APP_URL')")
    expect(entry).toMatch(/meta: \{\n\s+lang: 'en',\n\s+titleTemplate: '%s · \{\{name\}\}'/)
    expect(entry).toContain("head: [h('meta', { name: 'theme-color', content: '#ffffff' })]")
    // The client keeps <head> in sync from the page's meta; robots.txt is a route.
    expect(project.files.get('src/client/Layout.tsx')).toContain(
      "import { Seo } from '@/client/Seo'",
    )
    expect(project.files.get('src/client/Seo.tsx')).toContain('<Head title={meta.title}>')
    expect(project.files.has('public/robots.txt')).toBe(false)
    const seo = project.files.get('src/modules/seo/seo.controller.ts')!
    expect(seo).toContain("@Get('/sitemap.xml')")
    expect(seo).toContain("@Get('/robots.txt')")
    expect(project.files.get('src/modules/index.ts')).toContain('.mount(SeoModule())')
    const pages = project.files.get('src/modules/pages/pages.controller.ts')!
    expect(pages).toContain("title: 'Home'")
    // APP_URL through the injected ConfigService, not getEnv.
    expect(pages).toContain('constructor(private readonly config: ConfigService)')
    expect(pages).toContain("url: this.config.get('APP_URL')")
    expect(seo).toContain("baseUrl: this.config.get('APP_URL')")
    expect(entry).not.toContain('process.env.SESSION_SECRET')
    expect(entry).toContain("import './config'")
    expect(entry).toContain("session({ secret: getEnv('SESSION_SECRET')")
    // A fresh project's tests run before the client is built.
    expect(project.files.get('src/modules/pages/pages.test.ts')).toContain(
      "InertiaAdapter({ version: 'test' })",
    )
    expect(project.dependencies).toEqual(
      expect.arrayContaining(['@forinda/kickjs-inertia', '@inertiajs/react', 'react-dom']),
    )
    for (const pkg of [...project.dependencies, ...project.devDependencies]) {
      expect(
        (SIBLING_PACKAGES as readonly string[]).includes(pkg) || pkg in THIRD_PARTY_PACKAGES,
        pkg,
      ).toBe(true)
    }
  })

  it('ship one env schema per schema library', () => {
    for (const lib of ['zod', 'valibot', 'yup'] as const) {
      const project = renderLayers([`schema-${lib}`])
      const config = project.files.get('src/config/index.ts')!
      expect(config).toContain(`from '${lib}'`)
      // A side effect only: app code reads env through getEnv('KEY'), not an export.
      expect(config).toMatch(/^loadEnvFromSchema\(envSchema\)$/m)
      expect(config).not.toMatch(/export const env\b/)
      expect(config).toContain('export default envSchema')
      // Valibot's JSON Schema converter ships with it — Swagger reads Valibot schemas through it.
      expect(project.dependencies).toEqual(
        lib === 'valibot' ? ['valibot', '@valibot/to-json-schema'] : [lib],
      )
    }
  })
})

describe('env schema entries fail closed on secrets', () => {
  it('a secret-like key never gets a default that production would accept', async () => {
    const { readdirSync, readFileSync, existsSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { TEMPLATES_DIR } = await import('../src/scaffold/overlay')
    const entries = readdirSync(TEMPLATES_DIR)
      .map((layer) => join(TEMPLATES_DIR, layer, 'feature.json'))
      .filter(existsSync)
      .flatMap((file) => JSON.parse(readFileSync(file, 'utf8')).integrations ?? [])
      .filter((i: { slot?: string }) => i.slot?.startsWith('env-'))
    expect(entries.length).toBeGreaterThan(0)
    for (const { code } of entries as { code: string }[]) {
      const key = /^(\w+):/m.exec(code)![1]!
      if (!/SECRET|PASSWORD|TOKEN|_KEY/.test(key)) continue
      // A default is only allowed behind the dev/test-only refine.
      if (/\.default\(|optional\([^)]*,/.test(code)) {
        expect(code, key).toContain("['development', 'test'].includes(process.env.NODE_ENV ?? '')")
      }
    }
  })
})
