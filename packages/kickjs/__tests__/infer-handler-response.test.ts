import { describe, it, expectTypeOf } from 'vitest'

import type { InferHandlerResponse, Reply } from '../src/http/reply'
import type { RequestContext } from '../src/http/context'

/**
 * Type-level contract for InferHandlerResponse — what `kick typegen` R2
 * emits into `KickRoutes[...].response`. Purely compile-time.
 */

interface User {
  id: string
  name: string
}

describe('InferHandlerResponse (type-level)', () => {
  it('infers plain and async return types', () => {
    expectTypeOf<InferHandlerResponse<(ctx: RequestContext) => User>>().toEqualTypeOf<User>()
    expectTypeOf<InferHandlerResponse<(ctx: RequestContext) => Promise<User[]>>>().toEqualTypeOf<
      User[]
    >()
  })

  it('unwraps Reply<S, T> to T', () => {
    expectTypeOf<
      InferHandlerResponse<(ctx: RequestContext) => Promise<Reply<201, User>>>
    >().toEqualTypeOf<User>()
  })

  it('imperative void handlers stay unknown', () => {
    expectTypeOf<InferHandlerResponse<(ctx: RequestContext) => void>>().toEqualTypeOf<unknown>()
    expectTypeOf<
      InferHandlerResponse<(ctx: RequestContext) => Promise<void>>
    >().toEqualTypeOf<unknown>()
  })

  it('drops undefined members from mixed imperative/return handlers', () => {
    expectTypeOf<
      InferHandlerResponse<(ctx: RequestContext) => Promise<User | undefined>>
    >().toEqualTypeOf<User>()
  })

  it('non-function inputs degrade to unknown', () => {
    expectTypeOf<InferHandlerResponse<string>>().toEqualTypeOf<unknown>()
  })
})
