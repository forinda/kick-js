import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  ConfigService,
  createConfigService,
  getEnv,
  reloadEnv,
  resetEnvCache,
  withEnv,
} from '../src/index'

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

  it('survives a reload inside the callback', async () => {
    const seen = await withEnv({ FEATURE_X: 'on' }, () => {
      reloadEnv()
      return getEnv('FEATURE_X' as never)
    })
    expect(seen).toBe('on')
    expect(getEnv('FEATURE_X' as never)).toBeUndefined()
  })

  it('layers nested calls', async () => {
    const seen = await withEnv({ A_KEY: 1, B_KEY: 1 }, async () => {
      const inner = await withEnv({ B_KEY: 2 }, () => [
        getEnv('A_KEY' as never),
        getEnv('B_KEY' as never),
      ])
      return [...inner, getEnv('B_KEY' as never)]
    })
    expect(seen).toEqual([1, 2, 1])
  })
})

describe('getEnv fallback', () => {
  it('returns the fallback only when the value is unset', async () => {
    expect(getEnv('UNSET_KEY' as never, 'eu-west-1' as never)).toBe('eu-west-1')
    await withEnv({ SET_KEY: 'af-south-1' }, () => {
      expect(getEnv('SET_KEY' as never, 'eu-west-1' as never)).toBe('af-south-1')
    })
    await withEnv({ ZERO_KEY: 0 }, () => {
      expect(getEnv('ZERO_KEY' as never, 5 as never)).toBe(0) // 0 is a value, not unset
    })
  })

  it('still reads through a schema passed the old way, with a deprecation warning', () => {
    const warn = vi.spyOn(process, 'emitWarning').mockImplementation(() => {})
    process.env.LEGACY_KEY = 'legacy'
    try {
      const schema = z.object({ LEGACY_KEY: z.string() })
      expect(getEnv('LEGACY_KEY' as never, schema as never)).toBe('legacy')
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('deprecated'), 'DeprecationWarning')
    } finally {
      delete process.env.LEGACY_KEY
      warn.mockRestore()
    }
  })
})

describe('ConfigService.get fallback', () => {
  it('returns the fallback only when the value is unset, on both services', async () => {
    const config = new ConfigService()
    expect(config.get('UNSET_KEY' as never, 'x' as never)).toBe('x')
    await withEnv({ SET_KEY: 'y', ZERO_KEY: 0 }, () => {
      expect(config.get('SET_KEY' as never, 'x' as never)).toBe('y')
      expect(config.get('ZERO_KEY' as never, 5 as never)).toBe(0)
    })

    const Typed = createConfigService(z.object({ OPTIONAL_KEY: z.string().optional() }))
    const typed = new Typed()
    expect(typed.get('OPTIONAL_KEY', 'fallback')).toBe('fallback')
  })
})
