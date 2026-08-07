/**
 * `bootstrap({ onError })` is connect-SHAPED but not Express-SEMANTIC.
 *
 * The docblock used to call it "the standard Express error-handling
 * signature", which holds on exactly one of three runtimes:
 *
 *   Express  req = native Request   res = native Response   next = real
 *   Fastify  req = request.raw      res = reply driver      next = NO-OP
 *   h3       req = event.node.req   res = response driver   next = no-op
 *
 * Two consequences a handler author has to know: `next(err)` silently drops
 * the error off Express, and Express-only request members are `undefined`.
 * These assertions pin the runtimes' side of that contract so it cannot drift
 * from the documentation.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8')

describe('onError contract — what each runtime passes', () => {
  it('fastify hands the raw request, a reply driver, and a no-op next', () => {
    const s = src('http/runtimes/fastify.ts')
    // The error path passes these three, in this order.
    expect(s).toMatch(/setErrorHandler\(app, mw: ConnectMiddleware\)/)
    expect(s).toContain('request.raw')
    expect(s).toContain('replyDriver(reply)')
    expect(s).toContain('NOOP_NEXT')
    // NOOP_NEXT really is inert — the reason `next(err)` cannot delegate.
    expect(s).toMatch(/const NOOP_NEXT = \(\): void => \{\}/)
  })

  it('h3 also defines an inert next', () => {
    expect(src('http/runtimes/h3.ts')).toMatch(/const NOOP_NEXT = \(\): void => \{\}/)
  })

  it('express alone passes its native objects through', () => {
    // `app.use(mw)` — Express calls the handler with its own req/res/next.
    expect(src('http/runtimes/express.ts')).toMatch(
      /setErrorHandler\(app, mw: ConnectMiddleware\) \{\s*;\(app as any\)\.use\(mw\)/,
    )
  })
})

describe('onError contract — documentation matches the code', () => {
  const options = src('http/application.ts')

  it('no longer claims the Express signature holds everywhere', () => {
    expect(options).not.toContain('standard Express error-handling signature')
  })

  it('warns that next() is inert off Express', () => {
    expect(options).toMatch(/`next\(err\)` does nothing on Fastify and h3/)
  })

  it('warns that Express-only request members are absent', () => {
    expect(options).toMatch(/`req\.originalUrl`, `req\.path`, and `req\.ip` do not exist/)
  })
})
