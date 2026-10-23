/**
 * `kick build:netlify` / `kick build:vercel` resolve their settings from the
 * project layout, so a fullstack workspace and an API-only project both work
 * with no `deploy` block. The platform output is exact: Netlify reads the
 * function's `config` without running the file, and Vercel routes by `src`.
 */
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Command } from 'commander'
import { describe, expect, it } from 'vitest'

import { cronScheduleId as coreScheduleId } from '@forinda/kickjs'
import {
  appBuildOptions,
  appViteConfig,
  bareImportPackage,
  registerDeployCommands,
  netlifyHiddenRules,
  missingPackage,
  cronScheduleId,
  detectLayout,
  findCronDecorators,
  netlifyPublishDir,
  netlifyFunctionSource,
  resolveDeploy,
  vercelFunctionSource,
  vercelCrons,
  vercelRoutes,
  viewsPluginOptions,
} from '../src/commands/deploy'

/** Fake tree: every path in the set exists. */
const tree = (...paths: string[]) => {
  const set = new Set(paths)
  return (path: string) => set.has(path)
}

describe('detectLayout', () => {
  it('finds the fullstack workspace from a sibling web package', () => {
    const exists = tree('/repo/pnpm-workspace.yaml', '/repo/web/package.json')
    expect(detectLayout('/repo/server', exists)).toEqual({
      staticDir: '../web/dist',
      siteRoot: '..',
      apiPath: '/api',
    })
  })

  it('gives an API-only project every path, with no frontend to share with', () => {
    expect(detectLayout('/apps/api', tree('/apps/api/package.json'))).toEqual({
      siteRoot: '.',
      apiPath: '',
    })
  })

  it('stays API-only when the sibling directory is not a package', () => {
    const exists = tree('/repo/package.json', '/repo/web')
    expect(detectLayout('/repo/server', exists).staticDir).toBeUndefined()
  })
})

describe('resolveDeploy', () => {
  const fullstack = tree('/repo/pnpm-workspace.yaml', '/repo/web/package.json')

  it('fills every default from the detected layout', () => {
    expect(resolveDeploy(undefined, '/repo/server', fullstack)).toEqual({
      entry: 'src/serverless.ts',
      outDir: 'dist/serverless',
      staticDir: '../web/dist',
      siteRoot: '..',
      publishDir: 'dist/public',
      apiPath: '/api',
      external: ['valibot', 'yup'],
      vercelRuntime: 'nodejs22.x',
      include: [],
    })
  })

  it('lets config win over detection, including an empty apiPath', () => {
    const resolved = resolveDeploy(
      { apiPath: '', entry: 'src/edge.ts', external: [] },
      '/repo/server',
      fullstack,
    )
    expect(resolved.apiPath).toBe('')
    expect(resolved.entry).toBe('src/edge.ts')
    expect(resolved.external).toEqual([])
  })

  it('takes `staticDir: false` as "deploy the API alone"', () => {
    expect(resolveDeploy({ staticDir: false }, '/repo/server', fullstack).staticDir).toBeUndefined()
  })
})

describe('netlifyFunctionSource', () => {
  it('writes a literal config with no preferStatic', () => {
    const source = netlifyFunctionSource('../../../server/dist/serverless/server.mjs', '/api', {
      projectDir: '../../../server',
    })
    expect(source).toBe(`import { fileURLToPath } from 'node:url'
import { handler } from '../../../server/dist/serverless/server.mjs'

// Where the app's build files were packaged; the platform starts this
// function in another directory.
process.env.KICK_APP_ROOT ??= fileURLToPath(new URL('../../../server/', import.meta.url))

// Netlify's context carries waitUntil, so ctx.waitUntil() work finishes after the response.
export default (request, context) => handler.fetch(request, context)

export const config = {
  path: '/api/*',
}
`)
    // preferStatic makes a SPA rewrite shadow the function on production Netlify.
    expect(source).not.toContain('preferStatic')
  })

  it("gives the function every path when apiPath is ''", () => {
    expect(netlifyFunctionSource('../../../dist/serverless/server.mjs', '')).toContain("path: '/*'")
  })
})

describe('optional peers in the function bundle', () => {
  it('reads the package a bare import names', () => {
    expect(bareImportPackage('@valibot/to-json-schema')).toBe('@valibot/to-json-schema')
    expect(bareImportPackage('react-dom/server')).toBe('react-dom')
    expect(bareImportPackage('node:fs')).toBeUndefined()
    expect(bareImportPackage('./local')).toBeUndefined()
    expect(bareImportPackage('@/modules')).toBeUndefined()
  })

  it('leaves out a package no node_modules above the importer holds', () => {
    // pnpm keeps a dependency next to its importer, not at the project root.
    const exists = tree('/app/node_modules/.pnpm/schema/node_modules/zod/package.json')
    const from = '/app/node_modules/.pnpm/schema/node_modules/schema/dist'
    expect(missingPackage('zod', from, exists)).toBe(false)
    expect(missingPackage('@valibot/to-json-schema', from, exists)).toBe(true)
    expect(missingPackage('./sibling', from, exists)).toBe(false)
  })
})

describe('views apps', () => {
  const views = { '@forinda/kickjs-view': '^0.2.0' }

  it('serve dist/public before the function, which owns every path', () => {
    expect(resolveDeploy(undefined, '/apps/site', tree(), views)).toMatchObject({
      staticDir: 'dist/public',
      siteRoot: '.',
      apiPath: '',
    })
  })

  it('write client files into the static folder from the serverless build', () => {
    const resolved = resolveDeploy(undefined, '/apps/site', tree(), views)
    expect(viewsPluginOptions('/apps/site', resolved)).toEqual({ publicDir: '../public' })
    // No static folder to publish to: client files stay in the function's bundle.
    const off = resolveDeploy({ staticDir: false }, '/apps/site', tree(), views)
    expect(viewsPluginOptions('/apps/site', off)).toEqual({ clientFiles: 'bundle' })
    // Inertia keeps its own layout; no views plugin wiring for it here.
    const inertia = resolveDeploy(undefined, '/apps/site', tree(), {
      ...views,
      '@forinda/kickjs-inertia': '^0.2.0',
    })
    expect(inertia.staticDir).toBe('dist/client')
  })
})

describe('the function bundle', () => {
  it("takes the app's aliases and define from its Vite config", () => {
    const opts = appBuildOptions('/apps/site', {
      resolve: { alias: { '~': '/apps/site/lib', '@': '/apps/site/app' } },
      define: { __FLAG__: 'true' },
    })
    expect(opts.define).toEqual({ __FLAG__: 'true' })
    // The app's own aliases come first, so its `@` wins.
    expect(opts.resolve.alias).toEqual([
      { find: '~', replacement: '/apps/site/lib' },
      { find: '@', replacement: '/apps/site/app' },
      { find: '@', replacement: '/apps/site/src' },
    ])
    const list = appBuildOptions('/apps/site', {
      resolve: { alias: [{ find: /^#(.*)/, replacement: '/apps/site/$1' }] },
    })
    expect(list.resolve.alias).toHaveLength(2)
    expect(appBuildOptions('/apps/site', undefined)).toEqual({
      define: {},
      resolve: { alias: [{ find: '@', replacement: '/apps/site/src' }] },
    })
  })
})

describe('the app config for the function bundle', () => {
  it('is loaded as an SSR build, as Vite resolves it for one', async () => {
    let seen: unknown
    const config = await appViteConfig('/apps/site', async (env, file, root) => {
      seen = { env, file, root }
      return { config: { define: { __SSR__: String(env.isSsrBuild) } } }
    })
    expect(seen).toEqual({
      env: { command: 'build', mode: 'production', isSsrBuild: true },
      file: undefined,
      root: '/apps/site',
    })
    expect(config).toEqual({ define: { __SSR__: 'true' } })
    expect(await appViteConfig('/apps/site', async () => null)).toBeUndefined()
  })
})

describe('Inertia apps', () => {
  it('route every path to the function, with no SPA shell after it', () => {
    expect(vercelRoutes('', true)).toEqual([
      { handle: 'filesystem' },
      { src: '^/(.*)$', dest: '/api' },
    ])
  })

  it('answer 404 for build bookkeeping Netlify would publish', () => {
    expect(netlifyHiddenRules(['.vite'])).toEqual(['/.vite  /404  404!', '/.vite/*  /404  404!'])
  })

  const inertia = { '@forinda/kickjs-inertia': '^0.2.0' }

  it('publish the client build and package the manifest and SSR bundle', () => {
    const resolved = resolveDeploy(undefined, '/apps/site', tree(), inertia)
    expect(resolved).toMatchObject({
      staticDir: 'dist/client',
      siteRoot: '.',
      apiPath: '',
      include: ['dist/client/.vite/manifest.json', 'dist/ssr'],
    })
  })

  it('serve static files before the function, which owns every path', () => {
    const source = netlifyFunctionSource('../../../dist/serverless/server.mjs', '', {
      projectDir: '../../..',
      preferStatic: true,
      includedFiles: ['../../../dist/client/.vite/manifest.json', '../../../dist/ssr/**'],
    })
    expect(source).toContain(`export const config = {
  path: '/*',
  preferStatic: true,
  includedFiles: ["../../../dist/client/.vite/manifest.json","../../../dist/ssr/**"],
}`)
  })

  it('keep a deploy.include override', () => {
    const resolved = resolveDeploy({ include: ['data'] }, '/apps/site', tree(), inertia)
    expect(resolved.include).toEqual(['data'])
  })
})

describe('a runtime file the build has not made', () => {
  it.each(['build:netlify', 'build:vercel'])(
    'fails %s before writing anything',
    async (command) => {
      const root = mkdtempSync(join(tmpdir(), 'kick-deploy-include-'))
      try {
        writeFileSync(
          join(root, 'package.json'),
          JSON.stringify({ dependencies: { '@forinda/kickjs-inertia': '^0.2.0' } }),
        )
        const program = new Command().exitOverride()
        registerDeployCommands(program, { projectRoot: root, log: () => {} } as never)
        await expect(program.parseAsync(['node', 'kick', command])).rejects.toThrow(
          /dist\/client\/\.vite\/manifest\.json, dist\/ssr not found/,
        )
        // No function left behind that points at files it doesn't have.
        expect(existsSync(join(root, '.netlify'))).toBe(false)
        expect(existsSync(join(root, '.vercel'))).toBe(false)
        expect(existsSync(join(root, 'dist'))).toBe(false)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )
})

describe('vercelFunctionSource', () => {
  it("passes Vercel's per-request context (waitUntil) to handler.node", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kick-vercel-fn-'))
    writeFileSync(
      join(dir, 'server.mjs'),
      'export const calls = []\nexport const handler = { node: (req, res, platform) => calls.push({ req, res, platform }) }\n',
    )
    writeFileSync(join(dir, 'index.mjs'), vercelFunctionSource())
    const key = Symbol.for('@vercel/request-context')
    const context = { waitUntil: () => {} }
    const g = globalThis as Record<symbol, unknown>
    try {
      const entry = await import(pathToFileURL(join(dir, 'index.mjs')).href)
      // The app's build paths resolve against the function's own directory.
      expect(realpathSync(process.env.KICK_APP_ROOT!)).toBe(realpathSync(dir))
      const server = await import(pathToFileURL(join(dir, 'server.mjs')).href)

      entry.default('req', 'res') // not on Vercel: no context
      g[key] = { get: () => context }
      entry.default('req', 'res')

      expect(server.calls).toEqual([
        { req: 'req', res: 'res', platform: undefined },
        { req: 'req', res: 'res', platform: context },
      ])
    } finally {
      delete process.env.KICK_APP_ROOT
      delete g[key]
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('vercelRoutes', () => {
  it('adds the SPA fallback only when a frontend is published', () => {
    expect(vercelRoutes('/api', true)).toEqual([
      { handle: 'filesystem' },
      { src: '^/api/(.*)$', dest: '/api' },
      { src: '^/(.*)$', dest: '/index.html' },
    ])
    expect(vercelRoutes('', false)).toEqual([
      { handle: 'filesystem' },
      { src: '^/(.*)$', dest: '/api' },
    ])
  })

  it('routes the cron trigger to the function when the API path does not cover it', () => {
    expect(vercelRoutes('/api', true, true)).toEqual([
      { handle: 'filesystem' },
      { src: '^/api/(.*)$', dest: '/api' },
      { src: '^/_kick/(.*)$', dest: '/api' },
      { src: '^/(.*)$', dest: '/index.html' },
    ])
    expect(vercelRoutes('', false, true)).toEqual([
      { handle: 'filesystem' },
      { src: '^/(.*)$', dest: '/api' },
    ])
  })
})

describe('@Cron scan', () => {
  const source = `
import { Cron, Service } from '@forinda/kickjs'
const EVERY = '0 0 * * *'
@Service()
export class Jobs {
  @Cron('0 * * * *', { description: 'hourly (paren) in a string' })
  hourly() {}

  @Cron(\`*/5  * * * *\`, { timezone: 'Africa/Nairobi', enabled: () => (1 > 0) })
  sweep() {}

  @Cron(EVERY)
  daily() {}

  @Cron('0 * * * *', { name: 'second-hourly' })
  again() {}
}
`

  it('reads literal expressions, flags timezones and non-literals', () => {
    expect(findCronDecorators(source, 'src/jobs.ts')).toEqual([
      { file: 'src/jobs.ts', line: 6, expression: '0 * * * *', timezone: false },
      { file: 'src/jobs.ts', line: 9, expression: '*/5  * * * *', timezone: true },
      { file: 'src/jobs.ts', line: 12, expression: undefined, timezone: false },
      { file: 'src/jobs.ts', line: 15, expression: '0 * * * *', timezone: false },
    ])
  })

  it('writes one Vercel cron per distinct expression, with warnings', () => {
    const { crons, warnings } = vercelCrons(findCronDecorators(source, 'src/jobs.ts'))
    expect(crons).toEqual([
      { path: `/_kick/cron/${cronScheduleId('0 * * * *')}`, schedule: '0 * * * *' },
      { path: `/_kick/cron/${cronScheduleId('*/5 * * * *')}`, schedule: '*/5 * * * *' },
    ])
    expect(warnings).toEqual([
      'src/jobs.ts:9: Vercel crons run in UTC — the timezone option is ignored there',
      'src/jobs.ts:12: @Cron expression is not a string literal, so it has no Vercel cron entry',
    ])
  })

  it('skips expressions that are not five fields', () => {
    const { crons, warnings } = vercelCrons([
      { file: 'src/a.ts', line: 3, expression: '*/5 * * * * *', timezone: false },
    ])
    expect(crons).toEqual([])
    expect(warnings).toEqual([
      'src/a.ts:3: Vercel crons need a five-field expression, so it has no Vercel cron entry',
    ])
  })

  it('computes the same schedule id as the framework', () => {
    for (const expr of ['0 * * * *', ' */5  * * * * ', '0 9 * * MON-FRI', '@daily']) {
      expect(cronScheduleId(expr)).toBe(coreScheduleId(expr))
    }
  })
})

describe('netlifyPublishDir', () => {
  it("reads the toml's publish directory, normalised", () => {
    expect(
      netlifyPublishDir(
        '[build]\n  command = "pnpm run build:netlify"\n  publish = "./web/dist/"\n',
      ),
    ).toBe('web/dist')
    expect(netlifyPublishDir("[build]\n  publish = 'dist/public'\n")).toBe('dist/public')
  })

  it('returns nothing when the file declares no publish directory', () => {
    // The build then leaves it alone: Netlify's UI may carry the setting.
    expect(netlifyPublishDir('[build]\n  command = "pnpm run build:netlify"\n')).toBeUndefined()
  })
})
