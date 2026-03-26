import { describe, it, expect, beforeEach } from 'vitest'
import type {
  INotificationRepository,
  NewNotification,
} from '../domain/repositories/notification.repository'

// ── In-memory implementation ─────────────────────────────────────────

class InMemoryNotificationRepository implements INotificationRepository {
  private notifications: any[] = []

  async findById(id: string) {
    return this.notifications.find((n) => n.id === id) ?? null
  }
  async findPaginated(_parsed: any, recipientId: string) {
    const filtered = this.notifications.filter((n) => n.recipientId === recipientId)
    return { data: filtered, total: filtered.length }
  }
  async create(data: NewNotification) {
    const notification = {
      id: `n${this.notifications.length + 1}`,
      recipientId: data.recipientId,
      type: data.type,
      title: data.title,
      body: data.body,
      metadata: data.metadata ?? null,
      isRead: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.notifications.push(notification)
    return notification
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

// ── Tests ────────────────────────────────────────────────────────────

describe('InMemoryNotificationRepository', () => {
  let repo: INotificationRepository

  beforeEach(() => {
    repo = new InMemoryNotificationRepository()
  })

  it('create stores a notification and returns it with an id', async () => {
    const notification = await repo.create({
      recipientId: 'u1',
      type: 'task_assigned',
      title: 'New assignment',
      body: 'You were assigned a task',
    })

    expect(notification.id).toBeDefined()
    expect(notification.title).toBe('New assignment')
    expect(notification.isRead).toBe(false)
  })

  it('findById returns the correct notification', async () => {
    const created = await repo.create({
      recipientId: 'u1',
      type: 'comment',
      title: 'New comment',
      body: 'Someone commented',
    })
    const found = await repo.findById(created.id)

    expect(found).not.toBeNull()
    expect(found!.title).toBe('New comment')
  })

  it('findById returns null for unknown id', async () => {
    const found = await repo.findById('nonexistent')
    expect(found).toBeNull()
  })

  it('markRead marks a notification as read', async () => {
    const created = await repo.create({
      recipientId: 'u1',
      type: 'info',
      title: 'Info',
      body: 'Info body',
    })
    await repo.markRead(created.id)
    const found = await repo.findById(created.id)

    expect(found!.isRead).toBe(true)
  })

  it('markAllRead marks all user notifications as read', async () => {
    await repo.create({ recipientId: 'u1', type: 'a', title: 'A', body: 'A' })
    await repo.create({ recipientId: 'u1', type: 'b', title: 'B', body: 'B' })
    await repo.create({ recipientId: 'u2', type: 'c', title: 'C', body: 'C' })

    await repo.markAllRead('u1')

    expect(await repo.unreadCount('u1')).toBe(0)
    expect(await repo.unreadCount('u2')).toBe(1)
  })

  it('unreadCount returns correct count', async () => {
    await repo.create({ recipientId: 'u1', type: 'a', title: 'A', body: 'A' })
    await repo.create({ recipientId: 'u1', type: 'b', title: 'B', body: 'B' })

    expect(await repo.unreadCount('u1')).toBe(2)
  })

  it('delete removes the notification', async () => {
    const n = await repo.create({
      recipientId: 'u1',
      type: 'info',
      title: 'Temp',
      body: 'Temp body',
    })
    await repo.delete(n.id)

    const found = await repo.findById(n.id)
    expect(found).toBeNull()
  })
})
