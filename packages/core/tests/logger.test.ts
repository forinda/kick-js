import { describe, it, expect, vi } from 'vitest'
import { Logger, createLogger } from '@forinda/kickjs-core'

describe('Logger', () => {
  it('creates a named logger', () => {
    const log = new Logger('TestComponent')
    expect(log).toBeInstanceOf(Logger)
  })

  it('creates a logger without a name', () => {
    const log = new Logger()
    expect(log).toBeInstanceOf(Logger)
  })

  it('Logger.for() returns a cached instance', () => {
    const log1 = Logger.for('CacheTest')
    const log2 = Logger.for('CacheTest')
    expect(log1).toBe(log2) // Same reference
  })

  it('Logger.for() returns different instances for different names', () => {
    const log1 = Logger.for('ServiceA')
    const log2 = Logger.for('ServiceB')
    expect(log1).not.toBe(log2)
  })

  it('createLogger() is a shorthand for Logger.for()', () => {
    const log1 = createLogger('ShorthandTest')
    const log2 = Logger.for('ShorthandTest')
    expect(log1).toBe(log2)
  })

  it('child() creates a new logger instance', () => {
    const parent = Logger.for('Parent')
    const child = parent.child('Child')
    expect(child).toBeInstanceOf(Logger)
    expect(child).not.toBe(parent)
  })

  it('exposes all log level methods', () => {
    const log = Logger.for('MethodTest')
    expect(typeof log.info).toBe('function')
    expect(typeof log.warn).toBe('function')
    expect(typeof log.error).toBe('function')
    expect(typeof log.debug).toBe('function')
    expect(typeof log.trace).toBe('function')
    expect(typeof log.fatal).toBe('function')
  })

  it('does not throw when calling log methods', () => {
    const log = Logger.for('NoThrow')
    expect(() => log.info('test message')).not.toThrow()
    expect(() => log.warn('warning')).not.toThrow()
    expect(() => log.error('error')).not.toThrow()
    expect(() => log.debug('debug')).not.toThrow()
    expect(() => log.trace('trace')).not.toThrow()
    expect(() => log.error({ err: new Error('test') }, 'with object')).not.toThrow()
  })
})
