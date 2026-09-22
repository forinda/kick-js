/**
 * `kick build:netlify` / `kick build:vercel` resolve their settings from the
 * project layout, so a fullstack workspace and an API-only project both work
 * with no `deploy` block. The platform output is exact: Netlify reads the
 * function's `config` without running the file, and Vercel routes by `src`.
 */
import { describe, expect, it } from 'vitest'

import {
  detectLayout,
  netlifyPublishDir,
  netlifyFunctionSource,
  resolveDeploy,
  vercelRoutes,
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
    const source = netlifyFunctionSource('../../../server/dist/serverless/server.mjs', '/api')
    expect(source).toBe(`import { handler } from '../../../server/dist/serverless/server.mjs'

export default (request) => handler.fetch(request)

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
