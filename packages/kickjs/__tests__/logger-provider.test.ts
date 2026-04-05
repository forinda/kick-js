import 'reflect-metadata'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  Logger,
  createLogger,
  ConsoleLoggerProvider,
  type LoggerProvider,
} from '../src/index'

describe('Logger.setProvider() — pluggable logger backend', () => {
  afterEach(() => {
    Logger.resetProvider()
  })

  it('default provider is pino-based (not ConsoleLoggerProvider)', () => {
    const provider = Logger.getProvider()
    expect(provider).toBeDefined()
    expect(provider).not.toBeInstanceOf(ConsoleLoggerProvider)
  })

  it('custom provider receives log calls', () => {
    const calls: Array<{ level: string; msg: string; args: any[] }> = []
    const custom: LoggerProvider = {
      info: (msg, ...args) => calls.push({ level: 'info', msg, args }),
      warn: (msg, ...args) => calls.push({ level: 'warn', msg, args }),
      error: (msg, ...args) => calls.push({ level: 'error', msg, args }),
      debug: (msg, ...args) => calls.push({ level: 'debug', msg, args }),
      child: () => custom,
    }

    Logger.setProvider(custom)

    const log = Logger.for('TestService')
    log.info('hello %s', 'world')
    log.warn('caution')
    log.error('oops')
    log.debug('verbose')

    expect(calls).toHaveLength(4)
    expect(calls[0]).toEqual({ level: 'info', msg: 'hello %s', args: ['world'] })
    expect(calls[1]).toEqual({ level: 'warn', msg: 'caution', args: [] })
    expect(calls[2]).toEqual({ level: 'error', msg: 'oops', args: [] })
    expect(calls[3]).toEqual({ level: 'debug', msg: 'verbose', args: [] })
  })

  it('Logger.for() creates child loggers via provider.child()', () => {
    const childCalls: string[] = []
    const childProvider: LoggerProvider = {
      info: (msg) => childCalls.push(msg),
      warn: () => {},
      error: () => {},
      debug: () => {},
      child: () => childProvider,
    }

    const parentChildSpy = vi.fn(() => childProvider)
    const parent: LoggerProvider = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      child: parentChildSpy,
    }

    Logger.setProvider(parent)
    const log = Logger.for('MyComponent')

    expect(parentChildSpy).toHaveBeenCalledWith({ component: 'MyComponent' })

    log.info('from child')
    expect(childCalls).toContain('from child')
  })

  it('ConsoleLoggerProvider works as fallback', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})

    Logger.setProvider(new ConsoleLoggerProvider())

    const log = Logger.for('ConsoleTest')
    log.info('info message')
    log.warn('warn message')
    log.error('error message')
    log.debug('debug message')

    expect(logSpy).toHaveBeenCalledWith('[ConsoleTest] info message')
    expect(warnSpy).toHaveBeenCalledWith('[ConsoleTest] warn message')
    expect(errorSpy).toHaveBeenCalledWith('[ConsoleTest] error message')
    expect(debugSpy).toHaveBeenCalledWith('[ConsoleTest] debug message')

    logSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
    debugSpy.mockRestore()
  })

  it('setProvider() can be called multiple times (last wins)', () => {
    const calls1: string[] = []
    const calls2: string[] = []

    const provider1: LoggerProvider = {
      info: (msg) => calls1.push(msg),
      warn: () => {},
      error: () => {},
      debug: () => {},
      child: () => provider1,
    }
    const provider2: LoggerProvider = {
      info: (msg) => calls2.push(msg),
      warn: () => {},
      error: () => {},
      debug: () => {},
      child: () => provider2,
    }

    Logger.setProvider(provider1)
    const log1 = Logger.for('Svc')
    log1.info('first')
    expect(calls1).toEqual(['first'])
    expect(calls2).toEqual([])

    Logger.setProvider(provider2)
    const log2 = Logger.for('Svc')
    log2.info('second')
    expect(calls1).toEqual(['first'])
    expect(calls2).toEqual(['second'])
  })

  it('createLogger() uses the active provider', () => {
    const calls: string[] = []
    const custom: LoggerProvider = {
      info: (msg) => calls.push(msg),
      warn: () => {},
      error: () => {},
      debug: () => {},
      child: () => custom,
    }

    Logger.setProvider(custom)
    const log = createLogger('ViaCreateLogger')
    log.info('works')
    expect(calls).toContain('works')
  })

  it('trace/fatal fall back to debug/error when provider omits them', () => {
    const calls: Array<{ level: string; msg: string }> = []
    const custom: LoggerProvider = {
      info: () => {},
      warn: () => {},
      error: (msg) => calls.push({ level: 'error', msg }),
      debug: (msg) => calls.push({ level: 'debug', msg }),
      child: () => custom,
    }

    Logger.setProvider(custom)
    const log = Logger.for('FallbackTest')
    log.trace('trace msg')
    log.fatal('fatal msg')

    expect(calls).toEqual([
      { level: 'debug', msg: 'trace msg' },
      { level: 'error', msg: 'fatal msg' },
    ])
  })

  it('resetProvider() restores the default pino provider', () => {
    const custom: LoggerProvider = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      child: () => custom,
    }
    Logger.setProvider(custom)
    expect(Logger.getProvider()).toBe(custom)

    Logger.resetProvider()
    expect(Logger.getProvider()).not.toBe(custom)
    expect(Logger.getProvider()).not.toBeInstanceOf(ConsoleLoggerProvider)
  })
})
