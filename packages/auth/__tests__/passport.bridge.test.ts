import { describe, it, expect, vi } from 'vitest'
import 'reflect-metadata'
import { PassportBridge } from '@forinda/kickjs-auth'

describe('PassportBridge', () => {
  it('has the correct name', () => {
    const bridge = new PassportBridge('test', {
      authenticate: vi.fn(),
    })
    expect(bridge.name).toBe('test')
  })

  it('returns user when passport strategy calls success', async () => {
    const passportStrategy = {
      authenticate(req: any, options: any) {
        // Simulate passport calling this.success(user)
        ;(this as any).success({ id: '1', email: 'test@test.com' })
      },
    }

    const bridge = new PassportBridge('mock', passportStrategy)
    const req = { headers: { authorization: 'Bearer token' } }
    const user = await bridge.validate(req)

    expect(user).toEqual({ id: '1', email: 'test@test.com' })
  })

  it('returns null when passport strategy calls fail', async () => {
    const passportStrategy = {
      authenticate(req: any, options: any) {
        ;(this as any).fail('Invalid credentials')
      },
    }

    const bridge = new PassportBridge('mock-fail', passportStrategy)
    const user = await bridge.validate({ headers: {} })
    expect(user).toBeNull()
  })

  it('returns null when passport strategy calls error', async () => {
    const passportStrategy = {
      authenticate(req: any, options: any) {
        ;(this as any).error(new Error('Something went wrong'))
      },
    }

    const bridge = new PassportBridge('mock-error', passportStrategy)
    const user = await bridge.validate({ headers: {} })
    expect(user).toBeNull()
  })

  it('returns null when passport strategy throws', async () => {
    const passportStrategy = {
      authenticate() {
        throw new Error('Crash')
      },
    }

    const bridge = new PassportBridge('mock-throw', passportStrategy)
    const user = await bridge.validate({ headers: {} })
    expect(user).toBeNull()
  })

  it('returns null when passport strategy calls pass', async () => {
    const passportStrategy = {
      authenticate(req: any) {
        ;(this as any).pass()
      },
    }

    const bridge = new PassportBridge('mock-pass', passportStrategy)
    const user = await bridge.validate({ headers: {} })
    expect(user).toBeNull()
  })
})
