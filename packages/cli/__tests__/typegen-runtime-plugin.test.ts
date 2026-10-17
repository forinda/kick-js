/** `kick/runtime` typegen: every runtime, Express included, gets its augmentation. */
import { describe, expect, it } from 'vitest'
import { kickRuntimeTypegen } from '../src/typegen/builtin/runtime'
import type { TypegenContext } from '../src/typegen/plugin'

const generate = (runtime?: string) =>
  kickRuntimeTypegen().generate({
    config: runtime === undefined ? {} : { runtime },
  } as unknown as TypegenContext)

describe('kick/runtime typegen', () => {
  it.each([
    [undefined, "import('@forinda/kickjs/express').ExpressRuntimeTypes"],
    ['express', "import('@forinda/kickjs/express').ExpressRuntimeTypes"],
    ['fastify', "import('@forinda/kickjs/fastify').FastifyRuntimeTypes"],
    ['h3', "import('@forinda/kickjs/h3').H3RuntimeTypes"],
  ])('runtime %s → %s', async (runtime, type) => {
    expect(await generate(runtime)).toContain(`runtime: ${type}`)
  })

  it('emits nothing for a runtime it has no types for', async () => {
    expect(await generate('custom')).toBeNull()
  })
})
