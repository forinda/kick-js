import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { Container, Controller, Get, Put, Inject } from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'
import { buildRoutes } from '@forinda/kickjs-http'
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'
import {
  NOTIFICATION_REPOSITORY,
  type INotificationRepository,
} from '../domain/repositories/notification.repository'

// ── In-memory repository ─────────────────────────────────────────────

class InMemoryNotificationRepository implements INotificationRepository {
  private notifications: any[] = [
    {
      id: 'n1',
      recipientId: 'u1',
      type: 'task_assigned',
      title: 'New assignment',
      body: 'You were assigned a task',
      metadata: null,
      isRead: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'n2',
      recipientId: 'u1',
      type: 'comment',
      title: 'New comment',
      body: 'Someone commented',
      metadata: null,
      isRead: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]

  async findById(id: string) {
    return this.notifications.find((n) => n.id === id) ?? null
  }
  async findPaginated(_parsed: any, recipientId: string) {
    const filtered = this.notifications.filter((n) => n.recipientId === recipientId)
    return { data: filtered, total: filtered.length }
  }
  async create(data: any) {
    const n = {
      id: `n${this.notifications.length + 1}`,
      ...data,
      isRead: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.notifications.push(n)
    return n
  }
  async markRead(id: string) {
    const n = this.notifications.find((n) => n.id === id)
    if (n) n.isRead = true
  }
  async markAllRead(recipientId: string) {
    this.notifications
      .filter((n) => n.recipientId === recipientId)
      .forEach((n) => (n.isRead = true))
  }
  async unreadCount(recipientId: string) {
    return this.notifications.filter((n) => n.recipientId === recipientId && !n.isRead).length
  }
  async delete(id: string) {
    this.notifications = this.notifications.filter((n) => n.id !== id)
  }
}

// ── Test controller (no auth) ────────────────────────────────────────

@Controller()
class TestNotificationController {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY) private readonly repo: INotificationRepository,
  ) {}

  @Get('/')
  async list(ctx: RequestContext) {
    const result = await this.repo.findPaginated({} as any, 'u1')
    ctx.json({ data: result.data, total: result.total })
  }

  @Get('/unread-count')
  async unreadCount(ctx: RequestContext) {
    const count = await this.repo.unreadCount('u1')
    ctx.json({ data: { count } })
  }

  @Put('/:id/read')
  async markRead(ctx: RequestContext) {
    await this.repo.markRead(ctx.params.id)
    ctx.noContent()
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('NotificationController (integration)', () => {
  beforeEach(() => Container.reset())

  function buildTestModule() {
    return createTestModule({
      register: (c) => {
        c.registerFactory(NOTIFICATION_REPOSITORY, () => new InMemoryNotificationRepository())
        c.register(TestNotificationController, TestNotificationController)
      },
      routes: () => ({
        path: '/notifications',
        router: buildRoutes(TestNotificationController),
        controller: TestNotificationController,
      }),
    })
  }

  it('GET /api/v1/notifications returns notification list', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp).get('/api/v1/notifications').expect(200)

    expect(res.body.data).toHaveLength(2)
    expect(res.body.data[0].title).toBe('New assignment')
  })

  it('GET /api/v1/notifications/unread-count returns unread count', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp).get('/api/v1/notifications/unread-count').expect(200)

    expect(res.body.data.count).toBe(2)
  })

  it('PUT /api/v1/notifications/:id/read marks notification as read', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    await request(expressApp).put('/api/v1/notifications/n1/read').expect(204)

    const res = await request(expressApp).get('/api/v1/notifications/unread-count').expect(200)
    expect(res.body.data.count).toBe(1)
  })
})
