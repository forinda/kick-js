import { afterEach, describe, expect, it } from 'vitest'
import { getEnv, resetEnvCache, withEnv } from '../src/index'

afterEach(() => resetEnvCache())

describe('withEnv', () => {
  it('overlays parsed values for the call, then restores them — even after a throw', async () => {
    expect(getEnv('FEATURE_X' as never)).toBeUndefined()
    const seen = await withEnv({ FEATURE_X: true }, () => getEnv('FEATURE_X' as never))
    expect(seen).toBe(true)
    expect(getEnv('FEATURE_X' as never)).toBeUndefined()

    await expect(
      withEnv({ FEATURE_X: 1 }, () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(getEnv('FEATURE_X' as never)).toBeUndefined()
  })
})
