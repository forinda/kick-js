import { describe, it, expect } from 'vitest'
import 'reflect-metadata'
import { ApiKeyStrategy } from '@forinda/kickjs-auth'

describe('ApiKeyStrategy', () => {
  it('validates a valid static key', async () => {
    const strategy = new ApiKeyStrategy({
      keys: {
        'sk-test-123': { name: 'Test Bot', roles: ['api'] },
      },
    })

    const req = { headers: { 'x-api-key': 'sk-test-123' } }
    const user = await strategy.validate(req)

    expect(user).toEqual({ name: 'Test Bot', roles: ['api'] })
  })

  it('returns null for invalid key', async () => {
    const strategy = new ApiKeyStrategy({
      keys: { 'sk-valid': { name: 'Bot' } },
    })

    const req = { headers: { 'x-api-key': 'sk-wrong' } }
    expect(await strategy.validate(req)).toBeNull()
  })

  it('returns null when no key provided', async () => {
    const strategy = new ApiKeyStrategy({
      keys: { 'sk-valid': { name: 'Bot' } },
    })

    const req = { headers: {} }
    expect(await strategy.validate(req)).toBeNull()
  })

  it('supports custom header name', async () => {
    const strategy = new ApiKeyStrategy({
      keys: { 'key-123': { name: 'Bot' } },
      headerName: 'authorization',
    })

    const req = { headers: { authorization: 'key-123' } }
    const user = await strategy.validate(req)
    expect(user).toEqual({ name: 'Bot' })
  })

  it('supports query parameter', async () => {
    const strategy = new ApiKeyStrategy({
      keys: { 'key-123': { name: 'Bot' } },
      from: ['query'],
      queryParam: 'key',
    })

    const req = { headers: {}, query: { key: 'key-123' } }
    const user = await strategy.validate(req)
    expect(user).toEqual({ name: 'Bot' })
  })

  it('supports async validate function', async () => {
    const strategy = new ApiKeyStrategy({
      validate: async (key) => {
        if (key === 'db-key-456') return { name: 'DB User', roles: ['read'] }
        return null
      },
    })

    const req = { headers: { 'x-api-key': 'db-key-456' } }
    const user = await strategy.validate(req)
    expect(user).toEqual({ name: 'DB User', roles: ['read'] })
  })

  it('async validate takes precedence over static keys', async () => {
    const strategy = new ApiKeyStrategy({
      keys: { 'sk-static': { name: 'Static' } },
      validate: async () => ({ name: 'Dynamic' }),
    })

    const req = { headers: { 'x-api-key': 'sk-static' } }
    const user = await strategy.validate(req)
    expect(user).toEqual({ name: 'Dynamic' })
  })

  it('tries header then query in order', async () => {
    const strategy = new ApiKeyStrategy({
      keys: { 'from-query': { name: 'Query Bot' } },
      from: ['header', 'query'],
    })

    const req = { headers: {}, query: { api_key: 'from-query' } }
    const user = await strategy.validate(req)
    expect(user).toEqual({ name: 'Query Bot' })
  })
})
