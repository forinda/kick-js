import 'reflect-metadata'
import { describe, it, expect } from 'vitest'

describe('@forinda/kickjs unified exports', () => {
  it('exports core DI', async () => {
    const { Container, Scope } = await import('../src/index')
    expect(Container).toBeDefined()
    expect(typeof Container.getInstance).toBe('function')
    expect(typeof Container.reset).toBe('function')
    expect(typeof Container.create).toBe('function')
    expect(Scope.SINGLETON).toBeDefined()
  })

  it('exports decorators', async () => {
    const {
      Service, Controller, Get, Post, Put, Delete, Patch,
      Autowired, Inject, Value, Middleware,
    } = await import('../src/index')
    expect(typeof Service).toBe('function')
    expect(typeof Controller).toBe('function')
    expect(typeof Get).toBe('function')
    expect(typeof Post).toBe('function')
    expect(typeof Put).toBe('function')
    expect(typeof Delete).toBe('function')
    expect(typeof Patch).toBe('function')
    expect(typeof Autowired).toBe('function')
    expect(typeof Inject).toBe('function')
    expect(typeof Value).toBe('function')
    expect(typeof Middleware).toBe('function')
  })

  it('exports errors', async () => {
    const { HttpException, HttpStatus } = await import('../src/index')
    expect(typeof HttpException).toBe('function')
    expect(HttpStatus.OK).toBe(200)
    expect(HttpStatus.NOT_FOUND).toBe(404)
  })

  it('exports logger', async () => {
    const { createLogger, Logger } = await import('../src/index')
    expect(typeof createLogger).toBe('function')
    expect(typeof Logger).toBe('function')
  })

  it('exports reactivity', async () => {
    const { ref, computed, watch, reactive } = await import('../src/index')
    expect(typeof ref).toBe('function')
    expect(typeof computed).toBe('function')
    expect(typeof watch).toBe('function')
    expect(typeof reactive).toBe('function')
  })

  it('exports Application and bootstrap', async () => {
    const { Application, bootstrap } = await import('../src/index')
    expect(typeof Application).toBe('function')
    expect(typeof bootstrap).toBe('function')
  })

  it('exports RequestContext and buildRoutes', async () => {
    const { RequestContext, buildRoutes } = await import('../src/index')
    expect(typeof RequestContext).toBe('function')
    expect(typeof buildRoutes).toBe('function')
  })

  it('exports middleware factories', async () => {
    const { helmet, cors, csrf, rateLimit, requestId, requestLogger } = await import('../src/index')
    expect(typeof helmet).toBe('function')
    expect(typeof cors).toBe('function')
    expect(typeof csrf).toBe('function')
    expect(typeof rateLimit).toBe('function')
    expect(typeof requestId).toBe('function')
    expect(typeof requestLogger).toBe('function')
  })

  it('exports query parsing', async () => {
    const { parseQuery, FILTER_OPERATORS } = await import('../src/index')
    expect(typeof parseQuery).toBe('function')
    expect(typeof FILTER_OPERATORS).toBe('object')
  })

  it('exports path utilities', async () => {
    const { normalizePath, joinPaths } = await import('../src/index')
    expect(normalizePath('//foo///bar//')).toBe('/foo/bar')
    expect(joinPaths('/api', '/v1', '/users')).toBe('/api/v1/users')
  })
})
