/**
 * `ctx.session` is typed: a `Session` whose `data` reads augmented
 * `SessionData` keys with their declared types, and anything else as
 * `unknown`. It used to be `any`, so a typo compiled.
 */
import { describe, it, expectTypeOf } from 'vitest'
import type { RequestContext, Session } from '../src/index'

type Data = RequestContext['session']['data']

describe('ctx.session types', () => {
  it('is a Session', () => {
    expectTypeOf<RequestContext['session']>().toEqualTypeOf<Session>()
    expectTypeOf<Session['regenerate']>().returns.toEqualTypeOf<Promise<void>>()
  })

  it('reads declared keys with their types, others as unknown', () => {
    expectTypeOf<Data['userId']>().toEqualTypeOf<string | undefined>()
    expectTypeOf<Data['role']>().toEqualTypeOf<'admin' | 'member' | undefined>()
    expectTypeOf<Data['anythingElse']>().toEqualTypeOf<unknown>()
  })

  it('refuses a value of the wrong type for a declared key', () => {
    const assign = (ctx: RequestContext) => {
      // @ts-expect-error role is 'admin' | 'member'
      ctx.session.data.role = 'owner'
    }
    expectTypeOf(assign).toBeFunction()
  })
})
