import 'reflect-metadata'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Job, Process, QueueService, QueueAdapter, QUEUE_MANAGER } from '@forinda/kickjs-queue'
import { QUEUE_METADATA } from '../src/types'
import {
  getClassMetaOrUndefined,
  getClassMeta,
  Container,
  JOB_DISPATCHER,
  listJobHandlers,
  NoJobHandlerError,
} from '@forinda/kickjs'
import { Worker } from 'bullmq'
import { setObservers } from '../../kickjs/src/core/observers'

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
    static instances: Worker[] = []
    name: string
    processor: any
    close = vi.fn().mockResolvedValue(undefined)
    private listeners: Record<string, Function[]> = {}
    constructor(name: string, processor: any, _opts?: any) {
      this.name = name
      this.processor = processor
      Worker.instances.push(this)
    }
    on(event: string, handler: Function) {
      if (!this.listeners[event]) this.listeners[event] = []
      this.listeners[event].push(handler)
      return this
    }
    emit(event: string, ...args: unknown[]) {
      for (const handler of this.listeners[event] ?? []) handler(...args)
    }
  }

  return { Queue, Worker }
})

// ─── Helpers ────────────────────────────────────────────────────────────────

beforeEach(() => {
  Container.reset()
})

// ─── @Job decorator ─────────────────────────────────────────────────────────

describe('@Job decorator', () => {
  it('attaches queue name as metadata on the class', () => {
    @Job('emails')
    class EmailProcessor {}

    const queueName = getClassMetaOrUndefined<string>(QUEUE_METADATA.JOB, EmailProcessor)
    expect(queueName).toBe('emails')
  })

  it('makes the class discoverable by any runner (listJobHandlers)', () => {
    @Job('payments')
    class PaymentProcessor {
      @Process('charge')
      charge() {}
    }

    expect(
      listJobHandlers(Container.getInstance()).filter((h) => h.target === PaymentProcessor),
    ).toEqual([
      { queue: 'payments', jobName: 'charge', handlerName: 'charge', target: PaymentProcessor },
    ])
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
      await expect(service.add('missing', 'job', {})).rejects.toThrow('Queue "missing" not found')
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
    const adapter = QueueAdapter({ redis: redisOpts })
    expect(adapter.name).toBe('QueueAdapter')
  })

  it('pre-creates queues listed in options', async () => {
    const adapter = QueueAdapter({
      redis: redisOpts,
      queues: ['email', 'sms'],
    })

    const container = Container.getInstance()
    await adapter.beforeStart({ container } as any)

    expect(adapter.getQueueNames()).toContain('email')
    expect(adapter.getQueueNames()).toContain('sms')
  })

  it('discovers @Job classes and creates workers', async () => {
    @Job('worker-queue')
    class _WorkerProcessor {
      @Process('do-work')
      async handle() {}
    }

    const adapter = QueueAdapter({
      redis: redisOpts,
      queues: [],
    })

    const container = Container.getInstance()
    await adapter.beforeStart({ container } as any)

    // The queue should have been created for the discovered @Job class
    expect(adapter.getQueueNames()).toContain('worker-queue')
  })

  it('reports a failed job to the app’s error observers', async () => {
    @Job('reports-queue')
    class _ReportsProcessor {
      @Process('build')
      async handle() {}
    }
    const seen: unknown[] = []
    setObservers([{ name: 'rec', onError: (error, info) => void seen.push({ error, info }) }])
    try {
      const adapter = QueueAdapter({ redis: redisOpts })
      await adapter.beforeStart({ container: Container.getInstance() } as any)
      const worker = (
        Worker as unknown as { instances: { name: string; emit: Function }[] }
      ).instances.find((w) => w.name === 'reports-queue')!
      const err = new Error('render failed')
      worker.emit('failed', { name: 'build', id: '9', attemptsMade: 3 }, err)

      expect(seen).toEqual([
        {
          error: err,
          info: {
            source: 'job',
            context: { queue: 'reports-queue', job: 'build', id: '9', attemptsMade: 3 },
          },
        },
      ])
    } finally {
      setObservers([])
    }
  })

  it('skips @Job classes that have no @Process methods', async () => {
    @Job('empty-queue')
    class _EmptyProcessor {}

    const adapter = QueueAdapter({ redis: redisOpts })
    const container = Container.getInstance()
    await adapter.beforeStart({ container } as any)

    // The queue should NOT be created since there are no handlers
    expect(adapter.getQueueNames()).not.toContain('empty-queue')
  })

  it('registers QueueService in the DI container', async () => {
    const adapter = QueueAdapter({ redis: redisOpts })
    const container = Container.getInstance()
    await adapter.beforeStart({ container } as any)

    const resolved = container.resolve(QUEUE_MANAGER)
    expect(resolved).toBeInstanceOf(QueueService)
  })

  describe('getQueueStats', () => {
    it('returns stats for a registered queue', async () => {
      const adapter = QueueAdapter({
        redis: redisOpts,
        queues: ['stats-q'],
      })
      const container = Container.getInstance()
      await adapter.beforeStart({ container } as any)

      const stats = await adapter.getQueueStats('stats-q')
      expect(stats).toHaveProperty('waiting')
      expect(stats).toHaveProperty('active')
      expect(stats).toHaveProperty('completed')
      expect(stats).toHaveProperty('failed')
    })

    it('returns error for an unknown queue', async () => {
      const adapter = QueueAdapter({ redis: redisOpts })
      const container = Container.getInstance()
      await adapter.beforeStart({ container } as any)

      const stats = await adapter.getQueueStats('nope')
      expect(stats).toEqual({ error: 'Queue not found' })
    })
  })

  describe('shutdown', () => {
    it('closes workers and queues without throwing', async () => {
      @Job('shutdown-q')
      class _ShutdownProcessor {
        @Process()
        async handle() {}
      }

      const adapter = QueueAdapter({
        redis: redisOpts,
        queues: ['shutdown-q'],
      })
      const container = Container.getInstance()
      await adapter.beforeStart({ container } as any)

      await expect(adapter.shutdown()).resolves.toBeUndefined()
      // After shutdown, queues should be cleared
      expect(adapter.getQueueNames()).toEqual([])
    })
  })
})

describe('QueueAdapter panel routes', () => {
  const redis = { host: 'localhost', port: 6379 }
  const mountedPaths = (adapter: ReturnType<typeof QueueAdapter>) => {
    const paths: string[] = []
    adapter.beforeMount!({
      http: { route: (_m: string, path: string) => paths.push(path) },
    } as never)
    return paths
  }

  it('serves the DevTools panel outside production', () => {
    const adapter = QueueAdapter({ redis })
    expect(mountedPaths(adapter)).toEqual(['/_kick/queue/panel', '/_kick/queue/data'])
    expect(adapter.devtoolsTabs!()).toHaveLength(1)
  })

  it('mounts no unauthenticated routes in production, or when turned off', () => {
    vi.stubEnv('NODE_ENV', 'production')
    try {
      const adapter = QueueAdapter({ redis })
      expect(mountedPaths(adapter)).toEqual([])
      expect(adapter.devtoolsTabs!()).toEqual([])
      // Opting back in is explicit.
      expect(mountedPaths(QueueAdapter({ redis, panel: true }))).toHaveLength(2)
    } finally {
      vi.unstubAllEnvs()
    }
    expect(mountedPaths(QueueAdapter({ redis, panel: false }))).toEqual([])
  })
})

// ─── Running jobs through runJob ────────────────────────────────────────────

describe('QueueAdapter — jobs run through runJob', () => {
  const redisOpts = { host: 'localhost', port: 6379 }
  const workerFor = (name: string) =>
    (
      Worker as unknown as { instances: { name: string; processor: Function; emit: Function }[] }
    ).instances.findLast((w) => w.name === name)!

  it('routes to the named handler, else the catch-all, with the BullMQ job itself', async () => {
    const seen: unknown[] = []
    @Job('route-q')
    class _Route {
      @Process('a')
      a(job: unknown) {
        seen.push(['a', job])
      }
      @Process()
      other(job: unknown) {
        seen.push(['other', job])
      }
    }
    const adapter = QueueAdapter({ redis: redisOpts })
    await adapter.beforeStart({ container: Container.getInstance() } as any)
    const bull = { name: 'a', data: { x: 1 }, id: '1', attemptsMade: 0, updateProgress() {} }
    await workerFor('route-q').processor(bull)
    await workerFor('route-q').processor({ name: 'b', data: null, id: '2', attemptsMade: 0 })
    expect(seen[0]).toEqual(['a', bull])
    expect((seen[1] as unknown[])[0]).toBe('other')
  })

  it('reports a handler failure once — runJob reports it, the failed event does not repeat it', async () => {
    @Job('once-q')
    class _Once {
      @Process('x')
      x() {
        throw new Error('boom')
      }
    }
    const seen: unknown[] = []
    setObservers([{ name: 'rec', onError: (_e, info) => void seen.push(info) }])
    try {
      const adapter = QueueAdapter({ redis: redisOpts })
      await adapter.beforeStart({ container: Container.getInstance() } as any)
      const job = { name: 'x', data: {}, id: '7', attemptsMade: 2 }
      let thrown: unknown
      await workerFor('once-q')
        .processor(job)
        .catch((e: unknown) => (thrown = e))
      workerFor('once-q').emit('failed', job, thrown)
      expect(seen).toEqual([
        { source: 'job', context: { queue: 'once-q', job: 'x', id: '7', attemptsMade: 2 } },
      ])
    } finally {
      setObservers([])
    }
  })

  it('fails a job nothing handles instead of acknowledging it', async () => {
    @Job('nohandler-q')
    class _Only {
      @Process('known')
      known() {}
    }
    const adapter = QueueAdapter({ redis: redisOpts })
    await adapter.beforeStart({ container: Container.getInstance() } as any)
    await expect(
      workerFor('nohandler-q').processor({ name: 'unknown', data: null, attemptsMade: 0 }),
    ).rejects.toBeInstanceOf(NoJobHandlerError)
  })

  it('registers QueueService as the tool-neutral JOB_DISPATCHER', async () => {
    const adapter = QueueAdapter({ redis: redisOpts, queues: ['d-q'] })
    const container = Container.getInstance()
    await adapter.beforeStart({ container } as any)
    const dispatcher = container.resolve(JOB_DISPATCHER)
    expect(dispatcher).toBe(container.resolve(QUEUE_MANAGER))
    await expect(dispatcher.dispatch('d-q', 'go', { a: 1 })).resolves.toMatchObject({ id: '1' })
  })
})

describe('QueueAdapter — with a provider', () => {
  function fakeProvider() {
    const workers = new Map<
      string,
      (job: { name: string; data: unknown; id?: string }) => Promise<void>
    >()
    return {
      workers,
      addJob: vi.fn(async (queue: string, name: string, data: unknown) => ({ queue, name, data })),
      createWorker: vi.fn((queue: string, processor: any) => void workers.set(queue, processor)),
      shutdown: vi.fn(async () => {}),
    }
  }

  it('subscribes each handled queue, runs jobs through @Process, and dispatches through the provider', async () => {
    const done: unknown[] = []
    @Job('prov-q')
    class _Prov {
      @Process('ping')
      ping(job: { data: unknown }) {
        done.push(job.data)
      }
    }
    const provider = fakeProvider()
    const adapter = QueueAdapter({ provider })
    const container = Container.getInstance()
    await adapter.beforeStart({ container } as any)

    expect(provider.createWorker).toHaveBeenCalledWith('prov-q', expect.any(Function), 1)
    await provider.workers.get('prov-q')!({ name: 'ping', data: 42 })
    expect(done).toEqual([42])

    await container.resolve(JOB_DISPATCHER).dispatch('prov-q', 'ping', 43)
    expect(provider.addJob).toHaveBeenCalledWith('prov-q', 'ping', 43, undefined)

    await adapter.shutdown!()
    expect(provider.shutdown).toHaveBeenCalled()
  })
})
