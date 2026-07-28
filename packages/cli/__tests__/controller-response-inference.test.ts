import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createFixtureProject, cleanupFixture, runCli, runTsc, assertCliOk } from './helpers'

/**
 * Generated controllers must use RETURN-VALUE handlers, not `ctx.json(...)`.
 *
 * `kick typegen` fills `KickRoutes[...].response` with
 * `InferHandlerResponse<Controller['method']>`, which reads the handler's
 * RETURN type — nothing else. So the response style the CLI scaffolds decides
 * whether adopters get a typed client or not:
 *
 *   ctx.json(result)            → handler returns void → response: unknown
 *   return ctx.notFound(...)    → returns RuntimeResponse → response leaks a
 *                                 framework internal into the public route type
 *   return result               → response: the real payload type
 *
 * These are type-level assertions compiled by the fixture's own `tsc`, because
 * the emitted `response` is a type *reference* — reading the generated text
 * would look identical either way. The `.id` / `.total` property accesses are
 * the discriminator: they fail to compile against `unknown` and against
 * `RuntimeResponse`.
 */
describe('generated controllers infer a real response type', () => {
  let fixture: string

  beforeEach(() => {
    fixture = createFixtureProject('kick-response-inference')
  })

  afterEach(() => {
    cleanupFixture(fixture)
  })

  /**
   * Drop comment lines before asserting on emitted code. The templates
   * deliberately explain *why* they avoid `ctx.json()`, so a naive substring
   * check matches the prose rather than a call.
   */
  function codeOnly(source: string): string {
    return source
      .split('\n')
      .filter((line) => {
        const t = line.trim()
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
      })
      .join('\n')
  }

  /** Append a type-level assertion file and compile the whole fixture. */
  function assertTypes(source: string): void {
    writeFileSync(join(fixture, 'src/response-types.assert.ts'), source)
    const tsc = runTsc(fixture)
    if (tsc.exitCode !== 0) {
      throw new Error(`tsc failed:\nstdout:\n${tsc.stdout}\nstderr:\n${tsc.stderr}`)
    }
  }

  it('infers payload types for a minimal-pattern controller', () => {
    assertCliOk(runCli(fixture, ['g', 'module', 'widget', '--pattern', 'minimal']), 'g module')

    assertTypes(`
      type List = KickRoutes.WidgetController['list']['response']
      type One = KickRoutes.WidgetController['getById']['response']
      type Created = KickRoutes.WidgetController['create']['response']

      declare const list: List
      declare const one: One
      declare const created: Created

      // Each access fails to compile if the response degraded to \`unknown\`
      // or to the \`RuntimeResponse\` driver object.
      export const total: number = list.total
      export const id: string = one.id
      export const data: unknown = created.data
    `)
  })

  it('unwraps reply.created to its body type, not the Reply wrapper', () => {
    assertCliOk(runCli(fixture, ['g', 'controller', 'gadget']), 'g controller')

    assertTypes(`
      type Created = KickRoutes.GadgetController['create']['response']
      declare const created: Created
      // Reply<201, T> must unwrap to T — a leaked wrapper would expose
      // \`.status\` / \`.body\` instead of the payload shape.
      export const data: unknown = created.data
      // @ts-expect-error Reply wrapper must NOT survive into the route type
      export const status = created.status
    `)
  })

  it('keeps the 404 branch out of the success type', () => {
    // The rest scaffold's getById has a not-found branch. It must send via
    // `ctx.problem.*` and return nothing, so the error path contributes
    // `undefined` (dropped by InferHandlerResponse) rather than widening the
    // response to a union with a framework type.
    assertCliOk(runCli(fixture, ['g', 'scaffold', 'widget', 'title:string']), 'g scaffold')

    const controller = codeOnly(
      readFileSync(join(fixture, 'src/modules/widgets/widget.controller.ts'), 'utf-8'),
    )
    expect(controller).not.toContain('return ctx.notFound(')
    expect(controller).not.toContain('ctx.json(')
    expect(controller).toContain('ctx.problem.notFound(')
    expect(controller).toContain('return reply.created(')
    expect(controller).toContain('return reply.noContent()')
  })

  it('emits no ctx.json in any generated controller', () => {
    assertCliOk(runCli(fixture, ['g', 'module', 'alpha', '--pattern', 'minimal']), 'minimal')
    assertCliOk(runCli(fixture, ['g', 'controller', 'beta']), 'controller')
    assertCliOk(runCli(fixture, ['g', 'scaffold', 'gamma', 'title:string']), 'scaffold')

    for (const path of [
      'src/modules/alphas/alpha.controller.ts',
      'src/controllers/beta.controller.ts',
      'src/modules/gammas/gamma.controller.ts',
    ]) {
      const src = codeOnly(readFileSync(join(fixture, path), 'utf-8'))
      expect(src, `${path} still writes responses imperatively`).not.toContain('ctx.json(')
      expect(src, `${path} still writes responses imperatively`).not.toContain('ctx.created(')
      expect(src, `${path} still writes responses imperatively`).not.toContain('ctx.noContent()')
    }
  })

  it('scaffolds full CRUD even for the minimal pattern', () => {
    assertCliOk(runCli(fixture, ['g', 'module', 'widget', '--pattern', 'minimal']), 'g module')

    const controller = readFileSync(
      join(fixture, 'src/modules/widgets/widget.controller.ts'),
      'utf-8',
    )
    for (const method of ['list(', 'getById(', 'create(', 'update(', 'remove(']) {
      expect(controller, `minimal controller is missing ${method}`).toContain(method)
    }
    for (const decorator of ["@Get('/')", "@Get('/:id')", "@Post('/')", "@Put('/:id')"]) {
      expect(controller).toContain(decorator)
    }
    expect(controller).toContain("@Delete('/:id')")
  })
})
