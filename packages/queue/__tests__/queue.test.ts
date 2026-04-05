import 'reflect-metadata'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  Job,
  Process,
  QueueService,
  QueueAdapter,
  QUEUE_MANAGER,
} from '@forinda/kickjs-queue'
import { QUEUE_METADATA, jobRegistry } from '../src/types'
import {
  getClassMetaOrUndefined,
  getClassMeta,
  Container,
} from '@forinda/kickjs'

// ─── Mock bullmq ────────────────────────────────────────────────────────────
vi.mock('bullmq', () => {
  const mockAdd = vi.fn().mockResolvedValue({ id: '1', name: 'test' })
  const mockAddBulk = vi.fn().mockResolvedValue([{ id: '1' }, { id: '2' }])
  const mockClose = vi.fn().mockResolvedValue(undefined)
  const mockGetJobCounts = vi.fn().mockResolvedValue({
    waiting: 2,
    active: 1,
    completed: 10,
    failed: 0,
    delayed: 0,
    paused: 0,
  })

  class Queue {
    name: string
    add = mockAdd
    addBulk = mockAddBulk
    close = mockClose
    getJobCounts = mockGetJobCounts
    constructor(name: string, _opts?: any) {
      this.name = name
    }
  }

  class Worker {
    name: string
    processor: any
    close = vi.fn().mockResolvedValue(undefined)
    private listeners: Record<string, Function[]> = {}
    constructor(name: string, processor: any, _opts?: any) {
      this.name = name
      this.processor = processor
    }
    on(event: string, handler: Function) {
      if (!this.listeners[event]) this.listeners[event] = []
      this.listeners[event].push(handler)
      return this
    }
  }

  return { Queue, Worker }
})

// ─── Helpers ────────────────────────────────────────────────────────────────

beforeEach(() => {
  Container.reset()
  jobRegistry.clear()
})

// ─── @Job decorator ─────────────────────────────────────────────────────────

describe('@Job decorator', () => {
  it('attaches queue name as metadata on the class', () => {
    @Job('emails')
    class EmailProcessor {}

    const queueName = getClassMetaOrUndefined<string>(QUEUE_METADATA.JOB, EmailProcessor)
    expect(queueName).toBe('emails')
  })

  it('registers the class in the global jobRegistry', () => {
    @Job('payments')
    class PaymentProcessor {}

    expect(jobRegistry.has(PaymentProcessor)).toBe(true)
  })

  it('registers multiple distinct classes in the registry', () => {
    @Job('queue-a')
    class ProcessorA {}

    @Job('queue-b')
    class ProcessorB {}

    expect(jobRegistry.has(ProcessorA)).toBe(true)
    expect(jobRegistry.has(ProcessorB)).toBe(true)
    expect(jobRegistry.size).toBeGreaterThanOrEqual(2)
  })
})

// ─── @Process decorator ─────────────────────────────────────────────────────

describe('@Process decorator', () => {
  it('attaches a named process handler to the class metadata', () => {
    @Job('notifications')
    class NotifProcessor {
      @Process('push')
      async handlePush() {}
    }

    const handlers = getClassMeta<any[]>(QUEUE_METADATA.PROCESS, NotifProcessor, [])
    expect(handlers).toHaveLength(1)
    expect(handlers[0]).toEqual({ handlerName: 'handlePush', jobName: 'push' })
  })

  it('attaches a catch-all handler when no jobName is given', () => {
    @Job('logging')
    class LogProcessor {
      @Process()
      async handleAll() {}
    }

    const handlers = getClassMeta<any[]>(QUEUE_METADATA.PROCESS, LogProcessor, [])
    expect(handlers).toHaveLength(1)
    expect(handlers[0]).toEqual({ handlerName: 'handleAll', jobName: undefined })
  })

  it('supports multiple @Process methods on the same class', () => {
    @Job('multi')
    class MultiProcessor {
      @Process('a')
      async handleA() {}

      @Process('b')
      async handleB() {}

      @Process()
      async handleDefault() {}
    }

    const handlers = getClassMeta<any[]>(QUEUE_METADATA.PROCESS, MultiProcessor, [])
    expect(handlers).toHaveLength(3)

    const names = handlers.map((h: any) => h.jobName)
    expect(names).toContain('a')
    expect(names).toContain('b')
    expect(names).toContain(undefined)
  })
})

// ─── jobRegistry ────────────────────────────────────────────────────────────

describe('jobRegistry', () => {
  it('starts empty after clear', () => {
    expect(jobRegistry.size).toBe(0)
  })

  it('is a Set that deduplicates the same class', () => {
    @Job('dup')
    class DupProcessor {}

    // Add again manually — Set should deduplicate
    jobRegistry.add(DupProcessor)
    const count = [...jobRegistry].filter((c) => c === DupProcessor).length
    expect(count).toBe(1)
  })
})

// ─── QueueService ───────────────────────────────────────────────────────────

describe('QueueService', () => {
  let service: QueueService

  function makeMockQueue(name: string) {
    return {
      name,
      add: vi.fn().mockResolvedValue({ id: '1', name: 'job' }),
      addBulk: vi.fn().mockResolvedValue([{ id: '1' }, { id: '2' }]),
      close: vi.fn().mockResolvedValue(undefined),
      getJobCounts: vi.fn().mockResolvedValue({}),
    } as any
  }

  beforeEach(() => {
    service = new QueueService()
  })

  describe('registerQueue / getQueue', () => {
    it('stores and retrieves a queue by name', () => {
      const q = makeMockQueue('test')
      service.registerQueue('test', q)
      expect(service.getQueue('test')).toBe(q)
    })

    it('returns undefined for an unregistered queue', () => {
      expect(service.getQueue('nonexistent')).toBeUndefined()
    })
  })

  describe('getQueueNames', () => {
    it('returns all registered queue names', () => {
      service.registerQueue('a', makeMockQueue('a'))
      service.registerQueue('b', makeMockQueue('b'))
      expect(service.getQueueNames()).toEqual(['a', 'b'])
    })

    it('returns empty array when no queues registered', () => {
      expect(service.getQueueNames()).toEqual([])
    })
  })

  describe('add', () => {
    it('delegates to the queue.add method', async () => {
      const q = makeMockQueue('jobs')
      service.registerQueue('jobs', q)

      const result = await service.add('jobs', 'send-email', { to: 'a@b.com' })
      expect(q.add).toHaveBeenCalledWith('send-email', { to: 'a@b.com' }, undefined)
      expect(result).toEqual({ id: '1', name: 'job' })
    })

    it('passes options to queue.add', async () => {
      const q = makeMockQueue('jobs')
      service.registerQueue('jobs', q)

      const opts = { delay: 5000 }
      await service.add('jobs', 'delayed-job', { x: 1 }, opts)
      expect(q.add).toHaveBeenCalledWith('delayed-job', { x: 1 }, opts)
    })

    it('throws when the queue does not exist', async () => {
      await expect(service.add('missing', 'job', {})).rejects.toThrow(
        'Queue "missing" not found',
      )
    })
  })

  describe('addBulk', () => {
    it('delegates to queue.addBulk', async () => {
      const q = makeMockQueue('bulk')
      service.registerQueue('bulk', q)

      const jobs = [
        { name: 'j1', data: { a: 1 } },
        { name: 'j2', data: { b: 2 } },
      ]
      const result = await service.addBulk('bulk', jobs)
      expect(q.addBulk).toHaveBeenCalledWith(jobs)
      expect(result).toHaveLength(2)
    })

    it('throws when the queue does not exist', async () => {
      await expect(service.addBulk('missing', [{ name: 'j', data: {} }])).rejects.toThrow(
        'Queue "missing" not found',
      )
    })
  })

  describe('closeAll', () => {
    it('closes all queues and clears the map', async () => {
      const q1 = makeMockQueue('a')
      const q2 = makeMockQueue('b')
      service.registerQueue('a', q1)
      service.registerQueue('b', q2)

      await service.closeAll()

      expect(q1.close).toHaveBeenCalled()
      expect(q2.close).toHaveBeenCalled()
      expect(service.getQueueNames()).toEqual([])
    })

    it('does not throw when no queues are registered', async () => {
      await expect(service.closeAll()).resolves.toBeUndefined()
    })
  })
})

// ─── QueueAdapter ───────────────────────────────────────────────────────────

describe('QueueAdapter', () => {
  const redisOpts = { host: 'localhost', port: 6379 }

  it('has the name "QueueAdapter"', () => {
    const adapter = new QueueAdapter({ redis: redisOpts })
    expect(adapter.name).toBe('QueueAdapter')
  })

  it('pre-creates queues listed in options', () => {
    const adapter = new QueueAdapter({
      redis: redisOpts,
      queues: ['email', 'sms'],
    })

    const container = Container.getInstance()
    adapter.beforeStart({ container } as any)

    expect(adapter.getQueueNames()).toContain('email')
    expect(adapter.getQueueNames()).toContain('sms')
  })

  it('discovers @Job classes and creates workers', () => {
    @Job('worker-queue')
    class WorkerProcessor {
      @Process('do-work')
      async handle() {}
    }

    const adapter = new QueueAdapter({
      redis: redisOpts,
      queues: [],
    })

    const container = Container.getInstance()
    adapter.beforeStart({ container } as any)

    // The queue should have been created for the discovered @Job class
    expect(adapter.getQueueNames()).toContain('worker-queue')
  })

  it('skips @Job classes that have no @Process methods', () => {
    @Job('empty-queue')
    class EmptyProcessor {}

    const adapter = new QueueAdapter({ redis: redisOpts })
    const container = Container.getInstance()
    adapter.beforeStart({ container } as any)

    // The queue should NOT be created since there are no handlers
    expect(adapter.getQueueNames()).not.toContain('empty-queue')
  })

  it('registers QueueService in the DI container', () => {
    const adapter = new QueueAdapter({ redis: redisOpts })
    const container = Container.getInstance()
    adapter.beforeStart({ container } as any)

    const resolved = container.resolve(QUEUE_MANAGER)
    expect(resolved).toBeInstanceOf(QueueService)
  })

  describe('getQueueStats', () => {
    it('returns stats for a registered queue', async () => {
      const adapter = new QueueAdapter({
        redis: redisOpts,
        queues: ['stats-q'],
      })
      const container = Container.getInstance()
      adapter.beforeStart({ container } as any)

      const stats = await adapter.getQueueStats('stats-q')
      expect(stats).toHaveProperty('waiting')
      expect(stats).toHaveProperty('active')
      expect(stats).toHaveProperty('completed')
      expect(stats).toHaveProperty('failed')
    })

    it('returns error for an unknown queue', async () => {
      const adapter = new QueueAdapter({ redis: redisOpts })
      const container = Container.getInstance()
      adapter.beforeStart({ container } as any)

      const stats = await adapter.getQueueStats('nope')
      expect(stats).toEqual({ error: 'Queue not found' })
    })
  })

  describe('shutdown', () => {
    it('closes workers and queues without throwing', async () => {
      @Job('shutdown-q')
      class ShutdownProcessor {
        @Process()
        async handle() {}
      }

      const adapter = new QueueAdapter({
        redis: redisOpts,
        queues: ['shutdown-q'],
      })
      const container = Container.getInstance()
      adapter.beforeStart({ container } as any)

      await expect(adapter.shutdown()).resolves.toBeUndefined()
      // After shutdown, queues should be cleared
      expect(adapter.getQueueNames()).toEqual([])
    })
  })
})
