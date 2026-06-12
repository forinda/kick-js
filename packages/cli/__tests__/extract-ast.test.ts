import { resolve } from 'node:path'

import { describe, it, expect } from 'vitest'

import { extractFileAst } from '../src/typegen/extract-ast'
import { extractFileRegex } from '../src/typegen/scanner'

const CWD = resolve('/proj')
const FILE = resolve('/proj/src/modules/users/user.controller.ts')
const MODULE_FILE = resolve('/proj/src/modules/users/user.module.ts')

/** Run both extractors and assert deep equality (parity harness). */
function expectParity(source: string, filePath = FILE): void {
  const ast = extractFileAst(source, filePath, CWD)
  const regex = extractFileRegex(source, filePath, CWD)
  expect(ast).not.toBeNull()
  expect(ast).toEqual(regex)
}

describe('extractFileAst — parity with the regex extractors', () => {
  it('decorated classes (export, default export, stacked decorators)', () => {
    expectParity(`
import { Controller, Service } from '@forinda/kickjs'

@Service()
export class UserService {}

@Controller()
@Deprecated()
export default class UserController {}
`)
  })

  it('AppModule classes and defineModule consts tag as Module', () => {
    expectParity(`
import { defineModule, type AppModule, type Container } from '@forinda/kickjs'

export class LegacyModule implements AppModule {
  register(container: Container) {}
}

export const UserModule = defineModule({
  name: 'UserModule',
  build: () => ({ routes: () => null }),
})
`)
  })

  it('createToken — bare form (const form lives in the fixes section: regex double-emits it)', () => {
    expectParity(`
import { createToken } from '@forinda/kickjs'
container.registerFactory(createToken('app/Loose/token'), () => 1)
`)
  })

  it('@Inject literals (property and constructor-param positions)', () => {
    expectParity(`
import { Inject, Service } from '@forinda/kickjs'

@Service()
export class A {
  @Inject('app/Users/repository') private repo!: unknown
  constructor(@Inject('app/Cache/redis') private cache: unknown) {}
}
`)
  })

  it('defineAdapter / definePlugin / class-style AppAdapter', () => {
    expectParity(`
import { defineAdapter, definePlugin, type AppAdapter } from '@forinda/kickjs'

export const pg = defineAdapter({ name: 'postgres', beforeStart() {} })
export const audit = definePlugin({ name: 'audit-log' })

export class LegacyAdapter implements AppAdapter {
  name = 'legacy-adapter'
}
`)
  })

  it('defineAugmentation with and without metadata', () => {
    expectParity(`
import { defineAugmentation } from '@forinda/kickjs'
defineAugmentation('PolicyRegistry')
defineAugmentation('KickAssets', { description: 'Typed asset paths', example: 'assets.mails.welcome()' })
`)
  })

  it('context decorators — direct and curried withParams forms', () => {
    expectParity(`
import { defineContextDecorator, defineHttpContextDecorator } from '@forinda/kickjs'

export const LoadTenant = defineContextDecorator({
  key: 'tenant',
  resolve: (ctx) => ctx.req.headers['x-tenant-id'],
})

export const LoadProject = defineHttpContextDecorator.withParams<{ id: string }>()({
  key: 'project',
  resolve: () => null,
})
`)
  })

  it('routes — paths, params, schema refs, @ApiQueryParams (regex-visible order)', () => {
    // NOTE: @ApiQueryParams sits BELOW the HTTP decorator here because
    // the regex extractor only sees decorators after the route
    // decorator — the above-order case lives in the fixes section.
    expectParity(`
import { Controller, Get, Post, ApiQueryParams } from '@forinda/kickjs'
import { createUserSchema } from './user.dto'
const listQuerySchema = z.object({})

@Controller()
export class UserController {
  @Get('/:id')
  getUser(ctx) {}

  @Post('/', { body: createUserSchema, query: listQuerySchema })
  create(ctx) {}

  @Get('/')
  @ApiQueryParams({ filterable: ['name', 'age'], sortable: ['name'], searchable: ['name'] })
  list(ctx) {}
}
`)
  })

  it('module mounts + import.meta.glob patterns in module files', () => {
    expectParity(
      `
import { UserController } from './user.controller'

const contributors = import.meta.glob(['./**/*.controller.ts', '!./**/*.test.ts'], { eager: true })

export class UserModule implements AppModule {
  routes() {
    return [
      { path: '/users', controller: UserController },
      { path: '/admin/users', controller: AdminUserController },
    ]
  }
}
`,
      MODULE_FILE,
    )
  })
})

describe('extractFileAst — fixes over the regex path', () => {
  it('template-literal route paths extract (no-substitution form)', () => {
    const source = `
import { Controller, Get } from '@forinda/kickjs'

@Controller()
export class UserController {
  @Get(\`/v1/users/:id\`)
  getUser(ctx) {}
}
`
    const ast = extractFileAst(source, FILE, CWD)!
    expect(ast.routes[0]?.path).toBe('/v1/users/:id')
    expect(ast.routes[0]?.pathParams).toEqual(['id'])
  })

  it('@ApiQueryParams stacked ABOVE the HTTP decorator is still seen', () => {
    // The regex extractor only searched the text AFTER the route
    // decorator, so the natural above-stacking order silently lost the
    // whitelists. The AST reads all decorators on the method.
    const source = `
import { Controller, Get, ApiQueryParams } from '@forinda/kickjs'

@Controller()
export class UserController {
  @ApiQueryParams({ filterable: ['name'], sortable: [], searchable: [] })
  @Get('/')
  list(ctx) {}
}
`
    const ast = extractFileAst(source, FILE, CWD)!
    expect(ast.routes[0]?.queryFilterable).toEqual(['name'])
    const regex = extractFileRegex(source, FILE, CWD)
    expect(regex.routes[0]?.queryFilterable).toBeNull() // documented regex gap
  })

  it('const-bound createToken is emitted exactly once (regex double-emits)', () => {
    const source = `
import { createToken } from '@forinda/kickjs'
export const USER_REPO = createToken<UserRepo>('app/Users/repository')
container.registerFactory(createToken('app/Loose/token'), () => 1)
`
    const ast = extractFileAst(source, FILE, CWD)!
    expect(ast.tokens).toEqual([
      expect.objectContaining({ name: 'app/Users/repository', variable: 'USER_REPO' }),
      expect.objectContaining({ name: 'app/Loose/token', variable: null }),
    ])
    // Regex emits the const-bound token a second time as a bare call —
    // harmless downstream (the union dedupes) but documented here.
    const regex = extractFileRegex(source, FILE, CWD)
    expect(regex.tokens).toHaveLength(3)
  })

  it('string literals containing parens do not skew route extraction', () => {
    const source = `
import { Controller, Get, ApiOperation } from '@forinda/kickjs'

@Controller()
export class UserController {
  @ApiOperation({ summary: 'List (all) users :-)' })
  @Get('/users')
  list(ctx) {}
}
`
    const ast = extractFileAst(source, FILE, CWD)!
    expect(ast.routes).toHaveLength(1)
    expect(ast.routes[0]?.method).toBe('list')
    expect(ast.routes[0]?.path).toBe('/users')
  })

  it('aliased named imports resolve as schema sources', () => {
    const source = `
import { Controller, Post } from '@forinda/kickjs'
import { schema as createUserSchema } from './user.dto'

@Controller()
export class UserController {
  @Post('/', { body: createUserSchema })
  create(ctx) {}
}
`
    const ast = extractFileAst(source, FILE, CWD)!
    expect(ast.routes[0]?.bodySchema).toEqual({
      identifier: 'createUserSchema',
      source: './user.dto',
    })
  })

  it('returns null on unparseable source (caller falls back to regex)', () => {
    expect(extractFileAst('export class {{{', FILE, CWD)).toBeNull()
  })
})
