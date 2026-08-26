import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import * as h3v2 from 'h3-v2'

import { Application, type BootstrapOptions } from '../src/http/application'
import { Container } from '../src/core/container'
import { Controller, Get } from '../src/core/decorators'
import { buildMountPath } from '../src/core/path'
import { createWebApp } from '../src/web'
import type { RequestContext } from '../src/http/context'

/**
 * Opting out of URL versioning. `defaultVersion: false` drops the `/v{n}`
 * segment app-wide; a module's own `version` still wins in either direction,
 * so a single module can stay versioned (or opt out) against the app default.
 */

function makeController() {
  @Controller()
  class ThingsController {
    @Get('/')
    list(_ctx: RequestContext) {
      return { ok: true }
    }
  }
  return ThingsController
}

function moduleAt(path: string, version?: number | false) {
  return { routes: () => ({ path, version, controller: makeController() }) } as never
}

async function makeApp(options: Partial<BootstrapOptions> = {}, version?: number | false) {
  const app = new Application({ modules: [moduleAt('/things', version)], ...options })
  await app.setup()
  return app
}

beforeEach(() => {
  Container.reset()
})

describe('buildMountPath', () => {
  it('keeps the version segment for a numeric version', () => {
    expect(buildMountPath('/api', 1, '/things')).toBe('/api/v1/things')
  })

  it('drops the version segment when version is false', () => {
    expect(buildMountPath('/api', false, '/things')).toBe('/api/things')
  })

  it('mounts at the root when the prefix is empty and versioning is off', () => {
    expect(buildMountPath('', false, '/things')).toBe('/things')
  })

  it('never returns an empty mount path', () => {
    // Express throws on `app.use('', router)`; joinPaths floors this at '/'.
    expect(buildMountPath('', false, '/')).toBe('/')
  })

  it('collapses a trailing slash on the prefix', () => {
    expect(buildMountPath('/api/', 1, '/things')).toBe('/api/v1/things')
  })
})

describe('Application — versioned by default', () => {
  it('mounts under /api/v1', async () => {
    const app = await makeApp()
    await request(app.handle.bind(app)).get('/api/v1/things').expect(200)
  })
})

describe('Application — defaultVersion: false', () => {
  it('mounts under the prefix with no version segment', async () => {
    const app = await makeApp({ defaultVersion: false })
    const res = await request(app.handle.bind(app)).get('/api/things').expect(200)
    expect(res.body).toEqual({ ok: true })
  })

  it('no longer answers on the versioned path', async () => {
    const app = await makeApp({ defaultVersion: false })
    await request(app.handle.bind(app)).get('/api/v1/things').expect(404)
  })

  it('mounts at the root when apiPrefix is empty too', async () => {
    const app = await makeApp({ defaultVersion: false, apiPrefix: '' })
    await request(app.handle.bind(app)).get('/things').expect(200)
  })

  it('a module can still version itself — the per-mount value wins', async () => {
    const app = await makeApp({ defaultVersion: false }, 2)
    await request(app.handle.bind(app)).get('/api/v2/things').expect(200)
    await request(app.handle.bind(app)).get('/api/things').expect(404)
  })
})

describe('Application — per-module opt-out', () => {
  it('version: false drops the segment for that module only', async () => {
    @Controller()
    class VersionedController {
      @Get('/')
      list(_ctx: RequestContext) {
        return { ok: 'versioned' }
      }
    }
    const app = new Application({
      modules: [
        moduleAt('/things', false),
        { routes: () => ({ path: '/legacy', controller: VersionedController }) } as never,
      ],
    })
    await app.setup()

    await request(app.handle.bind(app)).get('/api/things').expect(200)
    await request(app.handle.bind(app)).get('/api/v1/legacy').expect(200)
  })
})

describe('createWebApp — defaultVersion: false', () => {
  it('drops the version segment on the web entry too', async () => {
    const app = createWebApp({
      h3: h3v2,
      defaultVersion: false,
      modules: [moduleAt('/things')],
    })

    const hit = await app.fetch(new Request('http://x/api/things'))
    expect(hit.status).toBe(200)
    expect(await hit.json()).toEqual({ ok: true })

    const miss = await app.fetch(new Request('http://x/api/v1/things'))
    expect(miss.status).toBe(404)
  })
})
