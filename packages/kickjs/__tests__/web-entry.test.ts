import 'reflect-metadata'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { describe, it, expect, beforeEach } from 'vitest'
import * as h3v2 from 'h3-v2'

import { createWebApp, createFetchHandler } from '../src/web'
import { Container } from '../src/core/container'
import { Controller, Get, Post, Service, Value } from '../src/core/decorators'
import { defineModule } from '../src/core/define-module'
import type { RequestContext } from '../src/http/context'

/**
 * `@forinda/kickjs/web` — the edge/Bun/Deno fetch entry. Round-trips real
 * decorated modules through `createWebApp().fetch(new Request(...))` and
 * enforces the bundle purity contract (design §3.4).
 */

beforeEach(() => {
  Container.reset()
})

function makeModule() {
  @Service()
  class GreetService {
    greet(name: string): string {
      return `hello ${name}`
    }
  }

  @Controller()
  class GreetController {
    private svc = Container.getInstance().resolve(GreetService)

    @Get('/hello/:name')
    async hello(ctx: RequestContext): Promise<void> {
      ctx.json({ msg: this.svc.greet(ctx.params.name) })
    }

    @Post('/echo')
    async echo(ctx: RequestContext): Promise<void> {
      ctx.created({ body: ctx.body })
    }
  }

  return defineModule({
    name: 'GreetModule',
    build: () => ({
      routes: () => ({ path: '/greet', controller: GreetController }),
    }),
  })()
}

describe('createWebApp — fetch entry', () => {
  it('serves decorated module routes end to end', async () => {
    const app = createWebApp({ h3: h3v2, modules: [makeModule()] })
    const res = await app.fetch(new Request('http://edge/api/v1/greet/hello/bun'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ msg: 'hello bun' })

    const posted = await app.fetch(
      new Request('http://edge/api/v1/greet/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ x: 1 }),
      }),
    )
    expect(posted.status).toBe(201)
    expect(await posted.json()).toEqual({ body: { x: 1 } })
  })

  it('respects apiPrefix + defaultVersion options', async () => {
    const app = createWebApp({
      h3: h3v2,
      modules: [makeModule()],
      apiPrefix: '/edge',
      defaultVersion: 3,
    })
    const res = await app.fetch(new Request('http://x/edge/v3/greet/hello/deno'))
    expect(res.status).toBe(200)
  })

  it('fails fast when handed h3 v1 (no H3 class)', () => {
    expect(() => createWebApp({ h3: { createApp: () => ({}) }, modules: [] })).toThrow(/h3 v2/)
  })

  it('seeds env for @Value resolution (Workers-style env binding)', async () => {
    @Service()
    class Cfg {
      @Value('EDGE_REGION')
      region!: string
    }

    @Controller()
    class CfgController {
      @Get('/region')
      async region(ctx: RequestContext): Promise<void> {
        ctx.json({ region: Container.getInstance().resolve(Cfg).region })
      }
    }

    const mod = defineModule({
      name: 'CfgModule',
      build: () => ({
        routes: () => ({ path: '/cfg', controller: CfgController }),
      }),
    })()

    const handler = createFetchHandler((env) => ({ h3: h3v2, modules: [mod], env }))
    const res = await handler.fetch(new Request('http://x/api/v1/cfg/region'), {
      EDGE_REGION: 'weur',
    })
    expect(await res.json()).toEqual({ region: 'weur' })
  })
})

describe('web entry — bundle purity (design §3.4)', () => {
  it('the built dist/web graph contains no node-only or express imports', () => {
    const distDir = resolve(__dirname, '../dist')
    const entry = join(distDir, 'web.mjs')
    expect(existsSync(entry), 'dist/web.mjs missing — run pnpm build first').toBe(true)

    // Walk relative imports transitively; collect every external specifier.
    const seen = new Set<string>()
    const externals = new Set<string>()
    const walk = (file: string): void => {
      if (seen.has(file)) return
      seen.add(file)
      const src = readFileSync(file, 'utf-8')
      for (const m of src.matchAll(
        /from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g,
      )) {
        const spec = m[1] ?? m[2]
        if (!spec) continue
        if (spec.startsWith('.')) {
          walk(resolve(dirname(file), spec))
        } else {
          externals.add(spec)
        }
      }
    }
    walk(entry)

    const forbidden = [...externals].filter(
      (s) =>
        s === 'express' ||
        s.startsWith('express/') ||
        (s.startsWith('node:') && s !== 'node:async_hooks'),
    )
    expect(
      forbidden,
      `edge purity violated — dist/web.mjs graph imports: ${forbidden.join(', ')}`,
    ).toEqual([])
  })
})
