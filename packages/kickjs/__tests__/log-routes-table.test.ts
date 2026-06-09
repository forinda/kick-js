import 'reflect-metadata'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import express from 'express'
import {
  Container,
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Logger,
  buildRoutes,
  Application,
  type ModuleRoutes,
} from '@forinda/kickjs'
import { createTestModule } from '@forinda/kickjs-testing'

// ── Fixtures ──────────────────────────────────────────────────────────────

@Controller()
class ItemController {
  @Get('/')
  list() {
    return []
  }

  @Post('/')
  create() {
    return { created: true }
  }

  @Delete('/:id')
  remove() {
    return { deleted: true }
  }
}

@Controller()
class UserController {
  @Get('/')
  list() {
    return []
  }

  @Put('/:id')
  update() {
    return { updated: true }
  }

  @Patch('/:id')
  patch() {
    return { patched: true }
  }
}

function makeModule(controllers: { cls: any; path: string }[]) {
  return createTestModule({
    register: (c) => {
      for (const { cls } of controllers) {
        c.register(cls, cls)
      }
    },
    routes: () =>
      controllers.map(
        ({ cls, path }): ModuleRoutes => ({
          path,
          router: buildRoutes(cls),
          controller: cls,
        }),
      ),
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────

let originalNodeEnv: string | undefined
let logCalls: string[]

function setupLogCapture() {
  logCalls = []
  const capture = (msg: string) => {
    logCalls.push(String(msg))
  }
  const noop = () => {}
  Logger.setProvider({
    info: capture,
    warn: noop,
    error: noop,
    debug: capture,
    child: () => ({
      info: capture,
      warn: noop,
      error: noop,
      debug: capture,
      child: () => ({}) as any,
    }),
  })
}

async function buildApp(options: {
  logRouteTable?: boolean
  logRoutesTable?: boolean
  nodeEnv?: string
}) {
  if (options.nodeEnv !== undefined) {
    process.env.NODE_ENV = options.nodeEnv
  }

  Container.reset()

  const TestModule = makeModule([
    { cls: ItemController, path: '/items' },
    { cls: UserController, path: '/users' },
  ])

  const app = new Application({
    modules: [TestModule],
    middleware: [express.json()],
    logRouteTable: options.logRouteTable,
    logRoutesTable: options.logRoutesTable,
  })

  await app.setup()
  return app
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('logRouteTable option', () => {
  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV
    setupLogCapture()
  })

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = originalNodeEnv
    }
    Logger.resetProvider()
    Container.reset()
  })

  // ── 1. Default: routes NOT logged (opt-in) ───────────────────────────

  it('does not log routes by default (development)', async () => {
    await buildApp({ nodeEnv: 'development' })

    const messages = logCalls
    const hasRoutesHeader = messages.some((m: string) => m.includes('Routes:'))

    expect(hasRoutesHeader).toBe(false)
  })

  // ── 2. Default: routes NOT logged in production either ────────────────

  it('does not log routes by default (production)', async () => {
    await buildApp({ nodeEnv: 'production' })

    const messages = logCalls
    const hasRoutesHeader = messages.some((m: string) => m.includes('Routes:'))

    expect(hasRoutesHeader).toBe(false)
  })

  // ── 3. logRouteTable: true opts in (even in production) ───────────────

  it('logs routes when logRouteTable is true', async () => {
    await buildApp({ nodeEnv: 'production', logRouteTable: true })

    const messages = logCalls
    const hasRoutesHeader = messages.some((m: string) => m.includes('Routes:'))
    const hasTotalLine = messages.some((m: string) => m.includes('Total:'))

    expect(hasRoutesHeader).toBe(true)
    expect(hasTotalLine).toBe(true)
  })

  // ── 4. Deprecated alias logRoutesTable still works ───────────────────

  it('logs routes via the deprecated logRoutesTable alias', async () => {
    await buildApp({ nodeEnv: 'production', logRoutesTable: true })

    const messages = logCalls
    expect(messages.some((m: string) => m.includes('Routes:'))).toBe(true)
  })

  // ── 4b. logRouteTable wins over the alias when both are set ───────────

  it('logRouteTable: false overrides logRoutesTable: true', async () => {
    await buildApp({ logRouteTable: false, logRoutesTable: true })

    const messages = logCalls
    expect(messages.some((m: string) => m.includes('Routes:'))).toBe(false)
  })

  // ── 5. Route log output includes correct HTTP methods and mount paths ─

  it('logs correct HTTP methods and mount paths for each controller', async () => {
    await buildApp({ nodeEnv: 'development', logRouteTable: true })

    const messages = logCalls

    // ItemController has GET, POST, DELETE on /items
    const itemLine = messages.find((m: string) => m.includes('ItemController'))
    expect(itemLine).toBeDefined()
    expect(itemLine).toMatch(/\/api\/v1\/items/)
    expect(itemLine).toMatch(/3 routes/)
    expect(itemLine).toMatch(/GET/)
    expect(itemLine).toMatch(/POST/)
    expect(itemLine).toMatch(/DELETE/)

    // UserController has GET, PUT, PATCH on /users
    const userLine = messages.find((m: string) => m.includes('UserController'))
    expect(userLine).toBeDefined()
    expect(userLine).toMatch(/\/api\/v1\/users/)
    expect(userLine).toMatch(/3 routes/)
    expect(userLine).toMatch(/GET/)
    expect(userLine).toMatch(/PUT/)
    expect(userLine).toMatch(/PATCH/)

    // Total should be 6 routes
    const totalLine = messages.find((m: string) => m.includes('Total:'))
    expect(totalLine).toMatch(/6 routes/)
  })

  // ── 6. Routes are sorted by method order ─────────────────────────────

  it('sorts methods in deterministic order: GET, POST, PUT, PATCH, DELETE', async () => {
    await buildApp({ nodeEnv: 'development', logRouteTable: true })

    const messages = logCalls

    // ItemController has GET, POST, DELETE — should appear in that order
    const itemLine = messages.find((m: string) => m.includes('ItemController'))
    expect(itemLine).toBeDefined()
    const itemGetIdx = itemLine!.indexOf('GET')
    const itemPostIdx = itemLine!.indexOf('POST')
    const itemDeleteIdx = itemLine!.indexOf('DELETE')
    expect(itemGetIdx).toBeLessThan(itemPostIdx)
    expect(itemPostIdx).toBeLessThan(itemDeleteIdx)

    // UserController has GET, PUT, PATCH — should appear in that order
    const userLine = messages.find((m: string) => m.includes('UserController'))
    expect(userLine).toBeDefined()
    const userGetIdx = userLine!.indexOf('GET')
    const userPutIdx = userLine!.indexOf('PUT')
    const userPatchIdx = userLine!.indexOf('PATCH')
    expect(userGetIdx).toBeLessThan(userPutIdx)
    expect(userPutIdx).toBeLessThan(userPatchIdx)
  })

  // ── Edge: default is off regardless of NODE_ENV ──────────────────────

  it('does not log routes when NODE_ENV is undefined and no option is set', async () => {
    delete process.env.NODE_ENV
    await buildApp({})

    const messages = logCalls
    const hasRoutesHeader = messages.some((m: string) => m.includes('Routes:'))

    expect(hasRoutesHeader).toBe(false)
  })
})
