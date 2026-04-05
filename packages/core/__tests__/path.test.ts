import { describe, it, expect } from 'vitest'
import { normalizePath, joinPaths } from '@forinda/kickjs-core'

describe('normalizePath', () => {
  it('returns empty string for /', () => {
    expect(normalizePath('/')).toBe('')
  })

  it('returns empty string for empty string', () => {
    expect(normalizePath('')).toBe('')
  })

  it('returns empty string for undefined', () => {
    expect(normalizePath(undefined)).toBe('')
  })

  it('returns empty string for whitespace', () => {
    expect(normalizePath('  ')).toBe('')
  })

  it('preserves normal paths', () => {
    expect(normalizePath('/users')).toBe('/users')
    expect(normalizePath('/api/v1/users')).toBe('/api/v1/users')
  })

  it('adds leading slash if missing', () => {
    expect(normalizePath('users')).toBe('/users')
    expect(normalizePath('api/v1')).toBe('/api/v1')
  })

  it('strips trailing slash', () => {
    expect(normalizePath('/users/')).toBe('/users')
    expect(normalizePath('/api/v1/')).toBe('/api/v1')
  })

  it('collapses double slashes', () => {
    expect(normalizePath('//users')).toBe('/users')
    expect(normalizePath('/api//v1')).toBe('/api/v1')
    expect(normalizePath('/api///v1//users/')).toBe('/api/v1/users')
  })

  it('trims whitespace', () => {
    expect(normalizePath('  /users  ')).toBe('/users')
  })

  it('handles parameterized paths', () => {
    expect(normalizePath('/users/:id')).toBe('/users/:id')
    expect(normalizePath('users/:id/posts/:postId')).toBe('/users/:id/posts/:postId')
  })
})

describe('joinPaths', () => {
  it('joins two path segments', () => {
    expect(joinPaths('/api/v1', '/users')).toBe('/api/v1/users')
  })

  it('handles trailing and leading slashes', () => {
    expect(joinPaths('/api/v1/', '/users')).toBe('/api/v1/users')
    expect(joinPaths('/api/v1/', '/users/')).toBe('/api/v1/users')
  })

  it('handles root path segments', () => {
    expect(joinPaths('/api/v1', '/')).toBe('/api/v1')
    expect(joinPaths('/api/v1', '')).toBe('/api/v1')
  })

  it('handles undefined segments', () => {
    expect(joinPaths('/api/v1', undefined)).toBe('/api/v1')
    expect(joinPaths(undefined, '/users')).toBe('/users')
  })

  it('joins multiple segments', () => {
    expect(joinPaths('/api', 'v1', 'users')).toBe('/api/v1/users')
    expect(joinPaths('/api', '/v1/', '/users/')).toBe('/api/v1/users')
  })

  it('handles missing leading slash', () => {
    expect(joinPaths('api', 'v1', 'users')).toBe('/api/v1/users')
  })

  it('prevents double slashes from / + /path', () => {
    // This is the exact case that caused /api/v1//projects/:id
    expect(joinPaths('/api/v1/', '/projects/:id')).toBe('/api/v1/projects/:id')
    expect(joinPaths('/api/v1', '/', '/projects/:id')).toBe('/api/v1/projects/:id')
  })

  it('returns / for empty or all-slash inputs', () => {
    expect(joinPaths('/')).toBe('/')
    expect(joinPaths('/', '/')).toBe('/')
    expect(joinPaths()).toBe('/')
  })

  it('handles parameterized paths', () => {
    expect(joinPaths('/api/v1', '/projects/:projectId/tasks/:taskId')).toBe(
      '/api/v1/projects/:projectId/tasks/:taskId',
    )
  })

  it('real-world: module path "/" with route path', () => {
    // Simulates: apiPrefix=/api, version=1, module path=/, route=/projects/:id
    const apiPrefix = '/api'
    const version = 1
    const modulePath = '/'
    const routePath = '/projects/:id'

    const mountPath = `${apiPrefix}/v${version}${normalizePath(modulePath)}`
    const fullPath = joinPaths(mountPath, routePath)

    expect(mountPath).toBe('/api/v1')
    expect(fullPath).toBe('/api/v1/projects/:id')
  })

  it('real-world: module path "/users" with route path', () => {
    const apiPrefix = '/api'
    const version = 1
    const modulePath = '/users'
    const routePath = '/:id'

    const mountPath = `${apiPrefix}/v${version}${normalizePath(modulePath)}`
    const fullPath = joinPaths(mountPath, routePath)

    expect(mountPath).toBe('/api/v1/users')
    expect(fullPath).toBe('/api/v1/users/:id')
  })
})
