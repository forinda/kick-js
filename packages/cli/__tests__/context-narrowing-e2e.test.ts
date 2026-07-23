import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { assertCliOk, cleanupFixture, createFixtureProject, runCli, runTsc } from './helpers'

// End-to-end proof for per-route context-key narrowing: scaffold a real
// project, run `kick typegen`, and put the result through tsc.
//
// The unit tests in context-key-narrowing.test.ts pin the resolution
// policy. This file pins the thing that actually matters to an adopter —
// that dropping a contributor decorator turns into a compile error, and
// that the safety valves genuinely stop it from firing when typegen
// can't see the whole picture.

let fixture: string

beforeEach(() => {
  fixture = createFixtureProject('narrowing')
})

afterEach(() => {
  cleanupFixture(fixture)
})

function write(relPath: string, contents: string): void {
  const full = join(fixture, relPath)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, contents)
}

const CONTRIBUTORS = `import { defineHttpContextDecorator } from '@forinda/kickjs'

export const OperatorPerm = defineHttpContextDecorator.withParams<{ action: string }>()({
  key: 'operatorPerm',
  resolve: (_ctx, _deps, p) => p.action,
})

export const LoadTenant = defineHttpContextDecorator({
  key: 'tenant',
  resolve: (ctx) => ({ id: String(ctx.req.headers['x-tenant-id']) }),
})
`

const META = `declare module '@forinda/kickjs' {
  interface ContextMeta {
    tenant: { id: string }
    operatorPerm: string
  }
}
`

/** Controller whose handler requires 'operatorPerm'. */
function controller(opts: { withPermDecorator: boolean }): string {
  return `import { Controller, Get, type Ctx } from '@forinda/kickjs'
import { LoadTenant, OperatorPerm } from '../contributors/perm'

${META}
@Controller()
export class AuditController {
  @LoadTenant
  ${opts.withPermDecorator ? "@OperatorPerm({ action: 'audit:read' })" : ''}
  @Get('/audit')
  audit(ctx: Ctx<KickRoutes.AuditController['audit']>) {
    return ctx.json({ perm: ctx.require('operatorPerm') })
  }
}
`
}

function typegen(): void {
  assertCliOk(runCli(fixture, ['typegen']), 'kick typegen')
}

function emittedRoutes(): string {
  return readFileSync(join(fixture, '.kickjs/types/kick__routes.ts'), 'utf-8')
}

describe('per-route context-key narrowing (end to end)', () => {
  it('compiles when the contributor decorator is applied', () => {
    write('src/contributors/perm.ts', CONTRIBUTORS)
    write('src/audit/audit.controller.ts', controller({ withPermDecorator: true }))
    typegen()

    expect(emittedRoutes()).toContain('contextKeys: "operatorPerm" | "tenant"')

    const tsc = runTsc(fixture)
    if (tsc.exitCode !== 0) throw new Error(`tsc should pass:\n${tsc.stdout}\n${tsc.stderr}`)
  })

  it('fails to compile when the decorator is dropped — the whole point', () => {
    write('src/contributors/perm.ts', CONTRIBUTORS)
    write('src/audit/audit.controller.ts', controller({ withPermDecorator: false }))
    typegen()

    // The key is gone from the route's proven set...
    expect(emittedRoutes()).toContain('contextKeys: "tenant"')

    // ...so requiring it no longer type-checks. Before narrowing this was
    // invisible: `ctx.get('operatorPerm')!` compiled either way and the
    // handler read undefined at request time.
    const tsc = runTsc(fixture)
    expect(tsc.exitCode).not.toBe(0)
    expect(`${tsc.stdout}${tsc.stderr}`).toContain('operatorPerm')
  })

  it('emits `never` for a route proven to carry no contributors', () => {
    write('src/contributors/perm.ts', CONTRIBUTORS)
    write(
      'src/plain/plain.controller.ts',
      `import { Controller, Get, type Ctx } from '@forinda/kickjs'
@Controller()
export class PlainController {
  @Get('/plain')
  plain(ctx: Ctx<KickRoutes.PlainController['plain']>) {
    return ctx.json({ ok: true })
  }
}
`,
    )
    typegen()
    expect(emittedRoutes()).toContain('contextKeys: never')
  })

  it('does not narrow a handler typed as plain RequestContext (escape hatch)', () => {
    // The documented way out when typegen's view is wrong: drop the
    // generated route type and TKeys falls back to `string`.
    write('src/contributors/perm.ts', CONTRIBUTORS)
    write(
      'src/escape/escape.controller.ts',
      `import { Controller, Get, type RequestContext } from '@forinda/kickjs'
${META}
@Controller()
export class EscapeController {
  @Get('/escape')
  escape(ctx: RequestContext) {
    return ctx.json({ perm: ctx.require('operatorPerm') })
  }
}
`,
    )
    typegen()

    const tsc = runTsc(fixture)
    if (tsc.exitCode !== 0) throw new Error(`tsc should pass:\n${tsc.stdout}\n${tsc.stderr}`)
  })

  it('narrows from a module-level contributors() hook', () => {
    // This case used to degrade the ENTIRE project — the scanner saw the
    // word `contributors` and gave up everywhere. It's now attributed to
    // the controllers the module mounts.
    write('src/contributors/perm.ts', CONTRIBUTORS)
    write(
      'src/audit/audit.controller.ts',
      `import { Controller, Get, type Ctx } from '@forinda/kickjs'
${META}
@Controller()
export class AuditController {
  @Get('/audit')
  audit(ctx: Ctx<KickRoutes.AuditController['audit']>) {
    return ctx.json({ tenant: ctx.require('tenant') })
  }
}
`,
    )
    write(
      'src/audit/audit.module.ts',
      `import { defineModule } from '@forinda/kickjs'
import { AuditController } from './audit.controller'
import { LoadTenant } from '../contributors/perm'

export const AuditModule = defineModule({
  name: 'Audit',
  build: () => ({
    routes: () => ({ path: '/audit', controller: AuditController }),
    contributors: () => [LoadTenant.registration],
  }),
})
`,
    )
    typegen()

    // The module hook supplies 'tenant' even though no decorator does.
    expect(emittedRoutes()).toContain('contextKeys: "tenant"')

    const tsc = runTsc(fixture)
    if (tsc.exitCode !== 0) throw new Error(`tsc should pass:\n${tsc.stdout}\n${tsc.stderr}`)
  })

  it('still rejects a key the module hook does not supply', () => {
    write('src/contributors/perm.ts', CONTRIBUTORS)
    write(
      'src/audit/audit.controller.ts',
      `import { Controller, Get, type Ctx } from '@forinda/kickjs'
${META}
@Controller()
export class AuditController {
  @Get('/audit')
  audit(ctx: Ctx<KickRoutes.AuditController['audit']>) {
    return ctx.json({ perm: ctx.require('operatorPerm') })
  }
}
`,
    )
    write(
      'src/audit/audit.module.ts',
      `import { defineModule } from '@forinda/kickjs'
import { AuditController } from './audit.controller'
import { LoadTenant } from '../contributors/perm'

export const AuditModule = defineModule({
  name: 'Audit',
  build: () => ({
    routes: () => ({ path: '/audit', controller: AuditController }),
    contributors: () => [LoadTenant.registration],
  }),
})
`,
    )
    typegen()

    const tsc = runTsc(fixture)
    expect(tsc.exitCode).not.toBe(0)
    expect(`${tsc.stdout}${tsc.stderr}`).toContain('operatorPerm')
  })

  it('narrows from a bootstrap-level contributors option', () => {
    // App-level contributors apply to every route, so they need no
    // attribution — their keys union into all of them.
    write('src/contributors/perm.ts', CONTRIBUTORS)
    write(
      'src/audit/audit.controller.ts',
      `import { Controller, Get, type Ctx } from '@forinda/kickjs'
${META}
@Controller()
export class AuditController {
  @Get('/audit')
  audit(ctx: Ctx<KickRoutes.AuditController['audit']>) {
    return ctx.json({ tenant: ctx.require('tenant') })
  }
}
`,
    )
    write(
      'src/index.ts',
      `import { bootstrap } from '@forinda/kickjs'
import { LoadTenant } from './contributors/perm'
export const app = bootstrap({ modules: [], contributors: [LoadTenant.registration] })
`,
    )
    typegen()

    expect(emittedRoutes()).toContain('contextKeys: "tenant"')

    const tsc = runTsc(fixture)
    if (tsc.exitCode !== 0) throw new Error(`tsc should pass:\n${tsc.stdout}\n${tsc.stderr}`)
  })

  it('degrades every route to `string` for an adapter-level registration', () => {
    // An adapter's `contributors()` body ships from a package we can't
    // read, so the keys it adds to every route are unknowable. Narrowing
    // anything after that would produce false compile errors.
    write('src/contributors/perm.ts', CONTRIBUTORS)
    write('src/audit/audit.controller.ts', controller({ withPermDecorator: false }))
    write(
      'src/adapters/audit.adapter.ts',
      `import { defineAdapter } from '@forinda/kickjs'
import { LoadTenant } from '../contributors/perm'

export const auditAdapter = defineAdapter({
  name: 'audit',
  build: () => ({
    contributors: () => [LoadTenant.registration],
  }),
})
`,
    )
    typegen()

    expect(emittedRoutes()).toContain('contextKeys: string')
    expect(emittedRoutes()).not.toContain('contextKeys: "')

    // The dropped decorator no longer errors — correctly, because the key
    // could legitimately be arriving from the adapter.
    const tsc = runTsc(fixture)
    if (tsc.exitCode !== 0) throw new Error(`tsc should pass:\n${tsc.stdout}\n${tsc.stderr}`)
  })
})
